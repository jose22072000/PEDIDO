import { Router } from 'express';
import prisma from '../prismaClient';
import { normalizarProducto, variantesProducto, porContenido } from '../lib/nombreProducto';
import { serviceAuth } from '../middleware/serviceAuth';

// Endpoints de integración servidor-a-servidor con delivery (todos con x-api-key).
// Modelo: delivery JALA los pedidos con geo del cliente, calcula el domicilio y
// ESCRIBE DE VUELTA el costo aquí (Pedido.costoDomicilio).
//
// SEGURIDAD DE SUCURSAL: cada instalación de PEDIDO es local a UNA sucursal
// (config.json.sucursalId). La integración se scopea a esa sucursal para que un
// delivery de una sucursal nunca vea ni escriba pedidos de otra.
import { clasificarParranda } from '../lib/webhook';
import { readConfiguredSucursalId } from '../lib/sucursalLocal';

const router = Router();
router.use(serviceAuth);


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
  /**
   * SIEMPRE hay tope, se pida o no.
   *
   * Sin `limit` esto devolvía todo lo que cuadrara con el filtro, y un cliente pidiendo
   * quince días se llevó ~7.000 pedidos con sus líneas en una sola respuesta: PEDIDO
   * tiene que construir ese JSON entero en memoria antes de mandarlo y se quedó sin
   * heap. La API se cayó por una petición perfectamente legítima.
   *
   * El tope va aquí y no en quien llama, porque quien llama puede ser cualquiera —y el
   * que tira el servicio no es el que se entera—.
   */
  const TOPE = 2000;
  const pedido = req.query.limit ? Number(req.query.limit) : TOPE;
  const limit = Number.isFinite(pedido) ? Math.min(Math.max(1, pedido), 5000) : TOPE;
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
    take: limit,
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

  /**
   * Los pesos de Ventra, resueltos AQUÍ y no por quien recibe.
   *
   * Antes se mandaba sólo el nombre del producto, así que cada aplicación que necesitara
   * el peso tenía que mantener su propio catálogo contra Ventra. Eso son dos catálogos
   * que se desincronizan sin que nadie lo note, y un domicilio cobrado por un peso que
   * no es el nuestro.
   *
   * El emparejado no es trivial —los nombres de Parranda no coinciden con los de Ventra,
   * "0.33L" contra "330 ML"— y ya lo hacemos para el panel. Hacerlo una vez aquí evita
   * que cada uno lo repita mal por su cuenta.
   *
   * Se cargan los catálogos de las sucursales que aparecen en ESTA página, no los diez:
   * una consulta por sucursal presente y no una por pedido.
   */
  const sucursalesEnPagina = [...new Set(pedidos.map((p) => p.sucursalId).filter(Boolean))] as string[];
  const catalogos = new Map<string, Map<string, number | null>>();

  for (const sid of sucursalesEnPagina) {
    const filas = await prisma.productoSucursal.findMany({
      where: { sucursalId: sid },
      select: { nombre: true, pesoKg: true },
    });
    const porNombre = new Map<string, number | null>();

    for (const f of filas) {
      const k = normalizarProducto(f.nombre);
      // Gana el que TIENE peso: Ventra manda el mismo producto duplicado, uno con peso
      // y otro sin él, y quedarse con el último perdía el dato que sí estaba.
      if (!porNombre.has(k) || (porNombre.get(k) == null && f.pesoKg != null)) {
        porNombre.set(k, f.pesoKg);
      }
    }
    catalogos.set(sid, porNombre);
  }

  const pesoDe = (sucursalId: string | null, producto: string | null): number | null => {
    if (!sucursalId || !producto) return null;
    const cat = catalogos.get(sucursalId);

    if (!cat) return null;

    const porVariante = variantesProducto(producto)
      .map((k) => (cat.has(k) ? cat.get(k) : undefined))
      .find((v) => v !== undefined);

    if (porVariante !== undefined) return porVariante ?? null;

    const k = porContenido(producto, [...cat.keys()]);

    return k ? cat.get(k) ?? null : null;
  };

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
      /**
       * El PESO y el PRECIO de cada línea, ya resueltos aquí.
       *
       * Antes se mandaba sólo el nombre del producto, y quien recibía esto tenía que
       * mantener su propio catálogo para saber cuánto pesa una caja de malta. Eso es un
       * segundo catálogo que se desincroniza del nuestro sin que nadie lo note: dos
       * sistemas con pesos distintos para el mismo producto, y un domicilio cobrado por
       * un peso que no es.
       *
       * El emparejado con Ventra ya lo hacemos para el panel, y no es trivial —los
       * nombres no coinciden, "0.33L" contra "330 ML"—. Hacerlo una vez aquí y mandar el
       * resultado ahorra que cada aplicación lo repita mal por su cuenta.
       *
       * `null` significa que en esa sucursal no hay ese producto ahora mismo, no que
       * falte el dato: se manda igual para que se vea la línea completa.
       */
      pesoKg: pesoDe(p.sucursalId, i.producto),
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
 * GET /integration/clients?sucursalCodigo=XXX&vendedor=andy.almanza   (x-api-key)
 * Clientes GEOLOCALIZADOS (con lat/lng) de la sucursal local. Delivery los espeja
 * localmente para armar órdenes personalizadas SELECCIONANDO el cliente (no recrearlo),
 * ya con su geo → sale el costo. SOLO con geo: sin coordenadas no se puede cotizar el
 * domicilio, así que no tiene sentido traerlos. Mismo scope de sucursal que /orders.
 */
router.get('/clients', async (req, res) => {
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  // Los clientes DE UN VENDEDOR.
  //
  // El cliente no tiene vendedor: la relación vive en los pedidos, así que "los
  // clientes de Andy" son los que alguna vez le compraron a Andy. Se acepta su código
  // ("andy.almanza", que es como lo nombra el CSV y la gente) o su id.
  //
  // Sirve para que una tablet se traiga SOLO su cartera en vez de los 8.850 clientes
  // de la sucursal: un repartidor no visita a los de otro.
  const vendedor = typeof req.query.vendedor === 'string' ? req.query.vendedor.trim() : '';
  // Incremental, igual que en /orders: lo que cambió desde la última sincronización.
  //
  // Sin esto, refrescar la cartera obliga a bajársela entera aunque no se haya movido
  // un dato. Con 8.850 clientes y datos móviles, eso es un minuto largo cada vez para,
  // casi siempre, no traer nada.
  const since = typeof req.query.since === 'string' ? req.query.since : '';

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

  // TODOS los clientes, no sólo los geolocalizados.
  //
  // Antes se filtraban por tener coordenadas, con el argumento de que sin ellas no hay
  // domicilio que calcular. Pero eso mezcla dos cosas: quién ES cliente de la sucursal,
  // y a quién se le puede cotizar hoy. En La Habana son 783 clientes y salían 599 — los
  // otros 184 sencillamente no existían para quien consumiera esto, y no había forma de
  // saber que faltaban.
  //
  // Quien necesite sólo los cotizables mira `latitud`, que viene en cada fila, o pide
  // `?conGeo=1`. Es mejor que le llegue el cliente y decida, a que se lo escondamos.
  const soloConGeo = req.query.conGeo === '1' || req.query.conGeo === 'true';

  const clientes = await prisma.cliente.findMany({
    where: {
      ...sucursalScope,
      ...(soloConGeo ? { latitud: { not: null }, longitud: { not: null } } : {}),
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
      // Por vendedor: los que tienen ALGÚN pedido suyo.
      ...(vendedor
        ? {
            pedidos: {
              some: {
                vendedor: {
                  OR: [{ codigo: vendedor }, { id: vendedor }],
                },
              },
            },
          }
        : {}),
    },
    include: { sucursal: { select: { codigo: true, nombre: true } } },
    // Al paginar se ordena por id: es único y estable, así ninguna fila se
    // repite ni se pierde entre páginas aunque cambien los nombres mientras
    // se recorre. Sin paginar se conserva el orden por nombre de siempre.
    orderBy: limit ? { id: 'asc' } : { nombre: 'asc' },
    ...(limit ? { take: limit } : {}),
    ...(limit && cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  // De quién es cada cliente.
  //
  // El cliente no tiene vendedor propio: esa relación vive en los pedidos. Se
  // resuelve aquí, para la página que se va a devolver, en UNA consulta: pedirlo
  // cliente por cliente serían 500 consultas para pintar 500 filas.
  //
  // OJO: ver la nota "PENDIENTE DE DECISIÓN" en routes/clientes.ts. Este `vendedor` es
  // el que delivery-apk guarda como `usuario_vendedor`, así que si allí se cambia el
  // criterio hay que cambiarlo aquí en la misma tanda: si no, el panel y la APK dirán
  // cosas distintas del mismo cliente y nadie sabrá cuál creer.
  //
  // `vendedor` es quien lo TRAJO —el de su pedido más antiguo—, que es el criterio
  // que ya usa la lista de clientes del panel. `vendedores` son todos los que le han
  // vendido: un cliente puede comprarle a dos, y quedarse solo con uno sería decidir
  // desde aquí a quién le toca la entrega.
  const idsClientes = clientes.map((c) => c.id);

  // Qué pares (cliente, vendedor) existen, y desde cuándo.
  //
  // En SQL y con DISTINCT ON porque la diferencia es de dos órdenes de magnitud:
  // traerse los pedidos de 500 clientes de Camagüey son decenas de miles de filas
  // para acabar quedándose con una o dos por cliente —la primera versión tardaba
  // veinte segundos y no llegaba a contestar—. Esto devuelve ya sólo el par, con la
  // fecha de su pedido más antiguo: unas 600 filas.
  const pares = idsClientes.length
    ? await prisma.$queryRaw<Array<{ clienteId: string; vendedorId: string; desde: Date }>>`
        SELECT DISTINCT ON ("clientId", "sellerId")
               "clientId" AS "clienteId", "sellerId" AS "vendedorId", fecha AS desde
          FROM "Order"
         WHERE "clientId" = ANY(${idsClientes}::text[])
           AND "sellerId" IS NOT NULL
         ORDER BY "clientId", "sellerId", fecha ASC`
    : [];

  // Los vendedores que salgan, una vez cada uno: son unas decenas aunque los clientes
  // sean miles.
  const idsVendedores = [...new Set(pares.map((r) => r.vendedorId))];
  const vendedores = idsVendedores.length
    ? await prisma.vendedor.findMany({
        where: { id: { in: idsVendedores } },
        select: {
          id: true, codigo: true, nombre: true,
          sucursal: { select: { id: true, codigo: true, nombre: true } },
          gestor: {
            select: {
              id: true, username: true,
              sucursal: { select: { id: true, codigo: true, nombre: true } },
            },
          },
        },
      })
    : [];

  type Vend = (typeof vendedores)[number];
  const comoSale = (v: Vend) => ({
    id: v.id,
    codigo: v.codigo,
    nombre: v.nombre,
    // La sucursal del vendedor, y la de su gestor. Normalmente son la misma; cuando
    // no lo son es que el vendedor está mal colocado, y verlo es mejor que que la APK
    // atribuya la entrega a la sucursal equivocada sin que nadie se entere.
    sucursalId: v.sucursal?.id ?? null,
    sucursalCodigo: v.sucursal?.codigo ?? null,
    sucursalNombre: v.sucursal?.nombre ?? null,
    gestor: v.gestor
      ? {
          id: v.gestor.id,
          usuario: v.gestor.username,
          sucursalId: v.gestor.sucursal?.id ?? null,
          sucursalCodigo: v.gestor.sucursal?.codigo ?? null,
          sucursalNombre: v.gestor.sucursal?.nombre ?? null,
        }
      : null,
  });

  const porId = new Map(vendedores.map((v) => [v.id, comoSale(v)]));

  // OJO: ver la nota "PENDIENTE DE DECISIÓN" en routes/clientes.ts.
  //
  // `vendedor` es quien lo TRAJO —el del pedido más antiguo—, que es el criterio que
  // ya usa la lista de clientes del panel. `vendedores` son todos los que le han
  // vendido: un cliente puede comprarle a dos, y quedarnos con uno sería decidir desde
  // aquí a quién le toca la entrega.
  const loTrajo = new Map<string, { desde: Date; vend: ReturnType<typeof comoSale> }>();
  const todosSus = new Map<string, Array<ReturnType<typeof comoSale>>>();
  for (const r of pares) {
    const v = porId.get(r.vendedorId);
    if (!v) continue;
    const antes = loTrajo.get(r.clienteId);
    if (!antes || r.desde < antes.desde) loTrajo.set(r.clienteId, { desde: r.desde, vend: v });
    if (!todosSus.has(r.clienteId)) todosSus.set(r.clienteId, []);
    todosSus.get(r.clienteId)!.push(v);
  }

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
    // La distancia que ya se calculó para este cliente, si alguien la calculó. Se
    // devuelve para que la APK no vuelva a medir lo que ya está medido — y para que
    // sepa DESDE DÓNDE se midió: si el almacén cambió de sitio, ese número hay que
    // rehacerlo.
    distanciaKm: c.distanciaKm,
    distanciaDesde: c.distanciaDesde,
    distanciaAt: c.distanciaAt,
    sucursalId: c.sucursalId,
    sucursalCodigo: c.sucursal?.codigo || null,
    sucursalNombre: c.sucursal?.nombre || null,
    // Quién lo trajo, con su sucursal y su gestor.
    vendedor: loTrajo.get(c.id)?.vend ?? null,
    // Y todos los que le han vendido, por si le compra a más de uno.
    vendedores: todosSus.get(c.id) ?? [],
    // Para que la tablet sepa por dónde seguir en la próxima sync.
    updatedAt: c.updatedAt,
  }));

  // nextCursor solo aparece si se pidió paginación Y la página vino llena:
  // una página incompleta significa que ya no queda nada más.
  const nextCursor = limit && clientes.length === limit
    ? clientes[clientes.length - 1].id
    : null;

  res.json({ count: clients.length, clients, ...(limit ? { nextCursor } : {}) });
});

/**
 * La puerta por la que delivery escribía el costo de domicilio: BORRADA.
 *
 * El costo lo pone la APK, por el webhook, que además guarda la tasa con la que cotizó
 * y deja rastro de quién movió al cliente. Esta ruta escribía el campo directamente,
 * sin nada de eso, y ya no la llamaba nadie.
 *
 * Se quita en vez de dejarla ahí sin usar porque una ruta viva es una ruta que alguien
 * puede llamar: cualquiera con la clave de servicio podía pisar en silencio el precio
 * que la APK acababa de calcular, y no habría quedado ni rastro de que pasó.
 */

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

/**
 * GET /integration/vendedores?sucursalCodigo=XXX&activos=1   (x-api-key)
 *
 * El MAESTRO de vendedores, entero. No los que han hecho pedidos: todos.
 *
 * # Para qué
 *
 * Rutas identifica a sus vendedores por el nombre de una carpeta de Drive
 * («ALEXANDER», «STGTadyslai», «TABLET3») y aquí se llaman como los llamó el maestro
 * («andy.almanza», «ALEXANDER RODRÍGUEZ»). Para cruzar los pedidos con el recorrido
 * hay que emparejar las dos listas, y eso lo hace una persona una vez por vendedor.
 *
 * Deducir la lista de los PEDIDOS no vale: quien está emparejando necesita ver a
 * TODOS —también al que todavía no ha vendido nada, y al que lleva un mes sin
 * pedidos— y si no, se queda esperando a que aparezcan para poder decir quiénes son.
 *
 * Es de solo lectura y no toca nada. La sucursal se scopea igual que en /orders y
 * /clients: cada instalación entrega lo suyo.
 */
router.get('/vendedores', async (req, res) => {
  const askedCodigo = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  // Por defecto SOLO los activos: un vendedor de baja no tiene a quién emparejar y
  // ensucia la lista. Con activos=0 salen todos, para revisar un histórico.
  const soloActivos = req.query.activos !== '0' && req.query.activos !== 'false';

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

  const vendedores = await prisma.vendedor.findMany({
    where: { ...sucursalScope, ...(soloActivos ? { activo: true } : {}) },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      activo: true,
      sucursalId: true,
      sucursal: { select: { codigo: true, nombre: true } },
      // Cuántos pedidos lleva: es lo que dice si un emparejamiento importa mucho o
      // poco, y quien está emparejando agradece verlo para empezar por los gordos.
      _count: { select: { pedidos: true } },
    },
    orderBy: { nombre: 'asc' },
  });

  const sellers = vendedores.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    nombre: v.nombre,
    activo: v.activo,
    sucursalId: v.sucursalId,
    sucursalCodigo: v.sucursal?.codigo ?? null,
    sucursalNombre: v.sucursal?.nombre ?? null,
    pedidos: v._count.pedidos,
  }));

  res.json({ count: sellers.length, sellers });
});

export default router;
