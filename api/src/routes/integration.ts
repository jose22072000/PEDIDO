import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prismaClient';
import { serviceAuth } from '../middleware/serviceAuth';

// Endpoints de integración servidor-a-servidor con delivery (todos con x-api-key).
// Modelo: delivery JALA los pedidos con geo del cliente, calcula el domicilio y
// ESCRIBE DE VUELTA el costo aquí (Pedido.costoDomicilio).
//
// SEGURIDAD DE SUCURSAL: cada instalación de PEDIDO es local a UNA sucursal
// (config.json.sucursalId). La integración se scopea a esa sucursal para que un
// delivery de una sucursal nunca vea ni escriba pedidos de otra.
import { clasificarParranda } from '../lib/webhook';

const router = Router();
router.use(serviceAuth);

const CONFIG_FILE = path.join(__dirname, '../../config.json');
function readConfiguredSucursalId(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as { sucursalId?: string | null };
    return parsed.sucursalId?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * GET /integration/orders?onlyPending=1&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&since=<ISO>&limit=500
 *
 * Lista pedidos para cotizar el domicilio. Con onlyPending=1 solo los que aún no
 * tienen costo y cuyo cliente TIENE geolocalización (calculables).
 *
 * # Por qué hay filtros de fecha
 *
 * Quien consume esto es una tablet, una por repartidor, sincronizando por datos
 * móviles y a veces sin cobertura. Traerse el histórico entero en cada arranque son
 * megas y minutos que la tablet no tiene, y encima el 99% son pedidos de hace meses
 * que ya nadie va a cotizar.
 *
 *   desde / hasta  → por FECHA DEL PEDIDO. "Dame los de hoy" o "los de ayer", que es
 *                    lo que el repartidor necesita tener encima antes de salir.
 *   estado         → en_proceso | completada | expirada. Con "en_proceso" se lleva
 *                    justo lo que va a repartir: lo completado ya se entregó y lo
 *                    expirado no lo va a llevar hoy.
 *   since          → por CUÁNDO ENTRÓ O CAMBIÓ (updatedAt). Es el sincronizado
 *                    incremental: se guarda la hora de la última sync y en la
 *                    siguiente solo llega lo que se movió desde entonces. Suele ser
 *                    nada o cuatro filas.
 *
 * Se pueden combinar. `since` es el que hace que una sync sea instantánea.
 */
router.get('/orders', async (req, res) => {
  const onlyPending = req.query.onlyPending === '1' || req.query.onlyPending === 'true';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  // Buscar UN pedido por su folio, que es como lo nombra todo el mundo: es lo que
  // lleva escrito el papel que tiene el repartidor en la mano.
  const folio = typeof req.query.folio === 'string' ? req.query.folio.trim() : '';
  // Por estado. El repartidor sale a la calle con los EN PROCESO: los completados ya
  // se entregaron y los expirados no los va a llevar hoy.
  const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : '';
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';

  // Scope a la sucursal local de esta instalación.
  const localSucursalId = readConfiguredSucursalId();
  let sucursalScope: Record<string, unknown> = {};
  if (localSucursalId) {
    sucursalScope = { sucursalId: localSucursalId };
    // Si delivery pide un código, debe ser el de ESTA sucursal; si no, se rechaza.
    if (askedCodigo) {
      const local = await prisma.sucursal.findUnique({ where: { id: localSucursalId } });
      if (local?.codigo && local.codigo !== askedCodigo) {
        return res.status(403).json({
          error: `Esta instalación es de la sucursal '${local.codigo}', no '${askedCodigo}'. No se entregan pedidos de otra sucursal.`,
        });
      }
    }
  } else if (askedCodigo) {
    // Sin config local: al menos filtra por el código pedido.
    sucursalScope = { sucursal: { codigo: askedCodigo } };
  }

  const where = {
    ...sucursalScope,
    // SIN GEOLOCALIZACIÓN no se manda a delivery: sin lat/lng no hay forma de medir la
    // distancia ni de rutear el pedido. (Antes solo se exigía para los pendientes.)
    cliente: { latitud: { not: null }, longitud: { not: null } },
    // Pendientes de cotizar = los que REQUIEREN domicilio (requiere_domicilio=true) y aún no
    // tienen costo. Un pedido sin domicilio NO lleva costo: no se encola ni se cotiza.
    ...(onlyPending ? { requiere_domicilio: true, costoDomicilio: null } : {}),
    // Por fecha del pedido. El 'hasta' incluye el día entero: quien escribe
    // hasta=2026-08-24 quiere los del 24, no los del 24 a las 00:00.
    ...(desde || hasta
      ? {
          fecha: {
            ...(desde ? { gte: new Date(`${desde}T00:00:00`) } : {}),
            ...(hasta ? { lte: new Date(`${hasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    // Incremental: lo que se movió desde la última sincronización.
    ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    // Por folio: contiene y sin distinguir mayúsculas, porque nadie teclea un folio
    // entero ni respeta las mayúsculas al buscar.
    ...(folio ? { folio: { contains: folio, mode: 'insensitive' as const } } : {}),
    // Por estado.
    //
    // "En proceso" y "expirado" NO son columnas: el único estado guardado es
    // 'completada', y expirado se deduce de que la fecha comprometida ya pasó. Así que
    // aquí se traducen a lo que sí se puede consultar, en vez de pedirle a quien llama
    // que sepa esa interioridad.
    ...(estado === 'completada' ? { estado: 'completada' } : {}),
    ...(estado === 'en_proceso'
      ? {
          NOT: { estado: 'completada' },
          OR: [{ fecha_comprometida: null }, { fecha_comprometida: { gte: new Date() } }],
        }
      : {}),
    ...(estado === 'expirada'
      ? { NOT: { estado: 'completada' }, fecha_comprometida: { lt: new Date() } }
      : {}),
  };

  const pedidos = await prisma.pedido.findMany({
    where,
    take: Number.isFinite(limit) ? limit : undefined,
    include: {
      cliente: true,
      sucursal: true,
      items: true,
      // La CADENA entera: pedido -> vendedor -> gestor -> sucursal.
      //
      // Antes se mandaba el pedido con su cliente y sus líneas y nada más, así que
      // quien recibía esto no podía responder de quién es el pedido ni de qué
      // sucursal sale: le llegaban vendedores, clientes y pedidos sueltos, todos al
      // mismo nivel, sin nada que los uniera. La sucursal de un pedido se deriva
      // vendedor -> gestor -> sucursal, y si no se manda el eslabón del medio, del
      // otro lado hay que adivinarla.
      vendedor: {
        select: {
          id: true, nombre: true, codigo: true, activo: true, sucursalId: true,
          gestor: {
            select: {
              id: true, username: true, sucursalId: true,
              sucursal: { select: { codigo: true, nombre: true } },
            },
          },
        },
      },
    },
    orderBy: { fecha: 'desc' },
  });

  // Se devuelve el pedido y el cliente COMPLETOS (todos sus datos), para que
  // delivery lo tenga todo y no se pierda nada.
  const orders = pedidos.map((p) => ({
    id: p.id,
    folio: p.folio,
    sucursalId: p.sucursalId,
    sucursalCodigo: p.sucursal?.codigo || null,
    sucursalNombre: p.sucursal?.nombre || null,
    direccion: p.direccion,
    encargado: p.encargado,
    telefono: p.telefono,
    fecha: p.fecha,
    fechaComprometida: p.fecha_comprometida,
    estado: p.estado,
    pedidoCobrado: p.pedido_cobrado,
    requiereDomicilio: p.requiere_domicilio,
    costoDomicilio: p.costoDomicilio,
    // Para que la tablet sepa por dónde seguir: se guarda el mayor de la tanda y se
    // manda como `since` en la siguiente sync.
    updatedAt: p.updatedAt,
    // De quién es el pedido, con su cadena de mando. `sucursalCodigo` de aquí abajo
    // es de dónde cuelga el VENDEDOR; el de arriba es el del pedido. Casi siempre son
    // el mismo, y cuando no lo son es justo lo que hay que mirar.
    vendedor: p.vendedor
      ? {
          id: p.vendedor.id,
          codigo: p.vendedor.codigo,
          nombre: p.vendedor.nombre,
          activo: p.vendedor.activo,
          sucursalId: p.vendedor.sucursalId,
          gestor: p.vendedor.gestor
            ? {
                id: p.vendedor.gestor.id,
                usuario: p.vendedor.gestor.username,
                sucursalId: p.vendedor.gestor.sucursalId,
                sucursalCodigo: p.vendedor.gestor.sucursal?.codigo ?? null,
                sucursalNombre: p.vendedor.gestor.sucursal?.nombre ?? null,
              }
            : null,
        }
      : null,
    cliente: p.cliente
      ? {
          id: p.cliente.id,
          codigo: p.cliente.codigo,
          nombre: p.cliente.nombre,
          zona: p.cliente.zona,
          direccion: p.cliente.direccion,
          municipio: p.cliente.municipio,
          tipoCliente: p.cliente.tipoCliente,
          estadoCompra: p.cliente.estadoCompra,
          latitud: p.cliente.latitud,
          longitud: p.cliente.longitud,
          geolocalizacion: p.cliente.geolocalizacion,
        }
      : null,
    items: p.items.map((i) => ({
      codigo: i.codigo,
      producto: i.producto,
      unidades: i.unidades,
      packs: i.packs,
      descripcion: i.descripcion,
    })),
  }));

  res.json({ count: orders.length, orders });
});

/**
 * GET /integration/orders/completados?since=<ISO>&limit=1000   (x-api-key)
 * PARA PARRANDA (pull): pedidos COMPLETADOS con la FECHA en que se completaron. Parranda
 * consulta cuándo se hicieron efectivos los pedidos. `since` (opcional) trae solo los
 * completados desde esa fecha (incremental). No necesita webhook/push: ellos consultan.
 */
router.get('/orders/completados', async (req, res) => {
  const sinceRaw = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
  const since = sinceRaw && !isNaN(sinceRaw.getTime()) ? sinceRaw : null;
  const limit = req.query.limit ? Math.min(5000, Math.max(1, Number(req.query.limit))) : 1000;

  const pedidos = await prisma.pedido.findMany({
    where: { completedAt: since ? { gte: since } : { not: null } },
    orderBy: { completedAt: 'desc' },
    take: limit,
    include: {
      cliente: { select: { codigo: true, nombre: true } },
      sucursal: { select: { codigo: true } },
      items: { select: { producto: true, unidades: true, packs: true } },
    },
  });

  const orders = pedidos.map((p) => ({
    folio: p.folio,
    sucursalCodigo: p.sucursal?.codigo || null,
    clienteCodigo: p.cliente?.codigo || null,
    clienteNombre: p.cliente?.nombre || null,
    estado: p.estado,
    completadoEn: p.completedAt,     // fecha en que el pedido se completó/efectivizó
    fecha: p.fecha,
    // SOLO productos Parranda: cerveza (330/500/1500) + Malta Guajira (330/1500).
    productos: p.items
      .map((it) => {
        const c = clasificarParranda(it.producto);
        return c ? { producto: c.producto, formatoMl: c.formatoMl, unidades: it.unidades, packs: it.packs } : null;
      })
      .filter(Boolean),
  }));

  res.json({ count: orders.length, orders });
});

/**
 * GET /integration/clients?sucursalCodigo=XXX   (x-api-key)
 * Clientes GEOLOCALIZADOS (con lat/lng) de la sucursal local. Delivery los espeja
 * localmente para armar órdenes personalizadas SELECCIONANDO el cliente (no recrearlo),
 * ya con su geo → sale el costo. SOLO con geo: sin coordenadas no se puede cotizar el
 * domicilio, así que no tiene sentido traerlos. Mismo scope de sucursal que /orders.
 */
router.get('/clients', async (req, res) => {
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';

  const localSucursalId = readConfiguredSucursalId();
  let sucursalScope: Record<string, unknown> = {};
  if (localSucursalId) {
    sucursalScope = { sucursalId: localSucursalId };
    if (askedCodigo) {
      const local = await prisma.sucursal.findUnique({ where: { id: localSucursalId } });
      if (local?.codigo && local.codigo !== askedCodigo) {
        return res.status(403).json({
          error: `Esta instalación es de la sucursal '${local.codigo}', no '${askedCodigo}'.`,
        });
      }
    }
  } else if (askedCodigo) {
    sucursalScope = { sucursal: { codigo: askedCodigo } };
  }

  // Paginación OPCIONAL por cursor. Sin `limit` se devuelve todo, igual que
  // siempre: un cliente viejo que no sepa paginar sigue funcionando tal cual.
  // Importa porque delivery BORRA de su espejo los clientes que no vengan en
  // la respuesta; si un cliente antiguo recibiera solo la primera página,
  // borraría el resto.
  const limitRaw = req.query.limit ? Number(req.query.limit) : null;
  const limit = limitRaw && Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 2000)
    : null;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;

  const clientes = await prisma.cliente.findMany({
    where: {
      ...sucursalScope,
      latitud: { not: null },
      longitud: { not: null },
    },
    include: { sucursal: { select: { codigo: true, nombre: true } } },
    // Al paginar se ordena por id: es único y estable, así ninguna fila se
    // repite ni se pierde entre páginas aunque cambien los nombres mientras
    // se recorre. Sin paginar se conserva el orden por nombre de siempre.
    orderBy: limit ? { id: 'asc' } : { nombre: 'asc' },
    ...(limit ? { take: limit } : {}),
    ...(limit && cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const clients = clientes.map((c) => ({
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    zona: c.zona,
    direccion: c.direccion,
    municipio: c.municipio,
    tipoCliente: c.tipoCliente,
    estadoCompra: c.estadoCompra,
    latitud: c.latitud,
    longitud: c.longitud,
    geolocalizacion: c.geolocalizacion,
    sucursalId: c.sucursalId,
    sucursalCodigo: c.sucursal?.codigo || null,
    sucursalNombre: c.sucursal?.nombre || null,
  }));

  // nextCursor solo aparece si se pidió paginación Y la página vino llena:
  // una página incompleta significa que ya no queda nada más.
  const nextCursor = limit && clientes.length === limit
    ? clientes[clientes.length - 1].id
    : null;

  res.json({ count: clients.length, clients, ...(limit ? { nextCursor } : {}) });
});

/**
 * POST /integration/orders/domicilio
 * Body: { updates: [{ id, costo, distanceKm? }] }
 * Delivery escribe el costo de domicilio calculado en cada pedido.
 */
router.post('/orders/domicilio', async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  const localSucursalId = readConfiguredSucursalId();
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const u of updates) {
    if (!u || !u.id || u.costo == null) continue;
    try {
      // updateMany con guard de sucursal local: nunca escribe en otra sucursal.
      const r = await prisma.pedido.updateMany({
        where: { id: String(u.id), ...(localSucursalId ? { sucursalId: localSucursalId } : {}) },
        data: { costoDomicilio: Number(u.costo) },
      });
      if (r.count > 0) updated++;
      else skipped++; // no existe o es de otra sucursal
    } catch (e) {
      errors.push({ id: String(u.id), error: (e as Error).message });
    }
  }

  res.json({ updated, skipped, errors });
});

/**
 * GET /integration/client-order-counts
 * Cantidad de pedidos por cliente (para la columna "pedidos" de analitics).
 * Devuelve [{ nombre, pedidos }]. Scopeado a la sucursal local.
 */
router.get('/client-order-counts', async (req, res) => {
  const localSucursalId = readConfiguredSucursalId();
  const where = localSucursalId
    ? { sucursalId: localSucursalId, clienteId: { not: null } }
    : { clienteId: { not: null } };

  const grouped = await prisma.pedido.groupBy({
    by: ['clienteId'],
    where,
    _count: { _all: true },
  });

  const clienteIds = grouped.map((g) => g.clienteId).filter((x): x is string => !!x);
  const clientes = await prisma.cliente.findMany({
    where: { id: { in: clienteIds } },
    select: { id: true, nombre: true },
  });
  const nombreById = new Map(clientes.map((c) => [c.id, c.nombre]));

  const counts = grouped
    .map((g) => ({ nombre: g.clienteId ? nombreById.get(g.clienteId) || '' : '', pedidos: g._count._all }))
    .filter((x) => x.nombre);

  res.json({ count: counts.length, counts });
});

export default router;
