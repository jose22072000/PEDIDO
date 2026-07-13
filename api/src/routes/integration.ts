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
 * GET /integration/orders?onlyPending=1&limit=500
 * Lista pedidos para que delivery los cotice. Con onlyPending=1 solo los que
 * aún no tienen costo y cuyo cliente TIENE geolocalización (calculables).
 */
router.get('/orders', async (req, res) => {
  const onlyPending = req.query.onlyPending === '1' || req.query.onlyPending === 'true';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
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
  };

  const pedidos = await prisma.pedido.findMany({
    where,
    take: Number.isFinite(limit) ? limit : undefined,
    include: { cliente: true, sucursal: true, items: true },
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
