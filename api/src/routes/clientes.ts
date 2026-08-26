import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import {
  resolveSucursalFilter,
  getRequesterContext,
  alcanceDeLectura,
  soloLoSuyo,
} from '../lib/sucursalContext';
import { parrandaQueue } from '../lib/queues';

const router = express.Router();

// POST /clientes/sync-parranda — dispara el sync de clientes desde Parranda (SOLO admin).
// ENCOLA un job; el worker lo procesa paginado (sin golpear la DB en el request).
router.post('/sync-parranda', async (req, res) => {
  const ctx = getRequesterContext(req);
  const serviceOk = !!process.env.SERVICE_API_KEY && req.header('x-api-key') === process.env.SERVICE_API_KEY;
  if (!ctx.isSuperAdmin && !serviceOk) {
    return res.status(403).json({ error: 'Solo el Super Admin (o el servicio) puede sincronizar clientes.' });
  }
  const q = parrandaQueue();
  if (!q) return res.status(503).json({ error: 'Redis/worker no disponible (sync por cola requerido).' });
  const job = await q.add({ reason: 'manual' });
  return res.status(202).json({ enqueued: true, jobId: String(job.id) });
});

// GET /clientes/resumen-parranda — resumen POR SUCURSAL (total / con geo) + último sync.
// Alimenta el panel de Configuración: ver qué entró por sucursal.
router.get('/resumen-parranda', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  try {
    const sucursales = await prisma.sucursal.findMany({
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: 'asc' },
    });
    const total = await prisma.cliente.groupBy({ by: ['sucursalId'], _count: { _all: true } });
    const conGeo = await prisma.cliente.groupBy({
      by: ['sucursalId'], where: { latitud: { not: null } }, _count: { _all: true },
    });
    const tMap = new Map(total.map((t) => [t.sucursalId, t._count._all]));
    const gMap = new Map(conGeo.map((g) => [g.sucursalId, g._count._all]));
    const porSucursal = sucursales.map((s) => {
      const t = tMap.get(s.id) ?? 0;
      const g = gMap.get(s.id) ?? 0;
      return { id: s.id, codigo: s.codigo, nombre: s.nombre, total: t, conGeo: g, sinGeo: t - g };
    });

    // Historial GLOBAL de corridas del worker (para ver que corre y no sobrecarga Parranda).
    let syncs: unknown[] = [];
    const q = parrandaQueue();
    if (q) {
      // Lo APLAZADO va aparte de lo que está esperando turno.
      //
      // Desde que el sync diario está programado, Bull deja siempre el de mañana como
      // job aplazado. Metido en el mismo saco que lo pendiente, la pantalla enseñaría
      // una "pendiente" que no se va nunca —y eso se lee como que algo se atascó,
      // justo lo contrario de lo que significa.
      const [completos, fallidos, activos, programados] = await Promise.all([
        q.getJobs(['completed'], 0, 15),
        q.getJobs(['failed'], 0, 5),
        q.getJobs(['active', 'waiting'], 0, 5),
        q.getJobs(['delayed'], 0, 3),
      ]);
      const map = (j: any, estado: string) => ({
        jobId: String(j.id), estado,
        resultado: estado === 'completado' ? j.returnvalue : undefined,
        error: estado === 'error' ? j.failedReason : undefined,
        cuando: j.finishedOn || j.processedOn || j.timestamp || null,
      });
      syncs = [
        ...activos.map((j) => map(j, 'pendiente')),
        ...completos.map((j) => map(j, 'completado')),
        ...fallidos.map((j) => map(j, 'error')),
      ].sort((a, b) => Number(b.jobId) - Number(a.jobId)).slice(0, 20);

      // Cuándo toca la próxima, en su propio campo: es la forma de comprobar de un
      // vistazo que lo automático sigue programado, que era justo lo que no se podía
      // saber cuando no lo estaba y nadie se enteró.
      const siguiente = programados
        .map((j: any) => Number(j.opts?.delay ? j.timestamp + j.opts.delay : 0))
        .filter((t) => t > 0)
        .sort((a, b) => a - b)[0];
      res.json({
        porSucursal,
        granTotal: porSucursal.reduce((a, s) => a + s.total, 0),
        granConGeo: porSucursal.reduce((a, s) => a + s.conGeo, 0),
        syncs,
        proximaSync: siguiente ?? null,
      });
      return;
    }
    res.json({
      porSucursal,
      granTotal: porSucursal.reduce((a, s) => a + s.total, 0),
      granConGeo: porSucursal.reduce((a, s) => a + s.conGeo, 0),
      syncs,
    });
  } catch (err) {
    console.error('resumen-parranda error:', err);
    res.status(500).json({ error: 'No se pudo obtener el resumen.' });
  }
});

// GET /clientes/parranda-lista — clientes PAGINADOS + filtros (sucursal, municipio, tipo,
// búsqueda, solo-geo). Devuelve la fecha (createdAt = cuándo entró/se sincronizó).
router.get('/parranda-lista', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 25));
    const sucursalId = (req.query.sucursalId as string) || undefined;
    const municipio = (req.query.municipio as string)?.trim() || undefined;
    const tipo = (req.query.tipo as string)?.trim() || undefined;
    const search = (req.query.search as string)?.trim().toUpperCase() || undefined;
    const soloGeo = req.query.soloGeo === '1' || req.query.soloGeo === 'true';

    const where: any = {};
    if (sucursalId) where.sucursalId = sucursalId;
    if (municipio) where.municipio = { contains: municipio };
    if (tipo) where.tipoCliente = { contains: tipo };
    if (soloGeo) where.latitud = { not: null };
    if (search) where.AND = search.split(/\s+/).filter(Boolean).map((w) => ({ nombre: { contains: w } }));

    const [total, data] = await Promise.all([
      prisma.cliente.count({ where }),
      prisma.cliente.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, nombre: true, codigo: true, municipio: true, direccion: true,
          tipoCliente: true, latitud: true, longitud: true, geolocalizacion: true,
          createdAt: true, updatedAt: true, sucursal: { select: { nombre: true, codigo: true } },
        },
      }),
    ]);
    res.json({ data, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error('parranda-lista error:', err);
    res.status(500).json({ error: 'No se pudo listar los clientes.' });
  }
});

// GET /clientes/municipios — municipios distintos (para el filtro), opcional por sucursal.
router.get('/municipios', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  const sucursalId = (req.query.sucursalId as string) || undefined;
  const rows = await prisma.cliente.findMany({
    where: { municipio: { not: null }, ...(sucursalId ? { sucursalId } : {}) },
    select: { municipio: true }, distinct: ['municipio'], orderBy: { municipio: 'asc' },
  });
  res.json({ municipios: rows.map((r) => r.municipio).filter(Boolean) });
});

// GET /clientes/sync-parranda/status/:jobId — pendiente | completado | error + resultado.
router.get('/sync-parranda/status/:jobId', async (req, res) => {
  const q = parrandaQueue();
  if (!q) return res.status(503).json({ error: 'Cola no disponible' });
  const job = await q.getJob(req.params.jobId);
  if (!job) return res.json({ jobId: req.params.jobId, estado: 'desconocido' });
  const state = await job.getState();
  const estado = state === 'completed' ? 'completado' : state === 'failed' ? 'error' : 'pendiente';
  return res.json({
    jobId: String(job.id), estado, state,
    resultado: state === 'completed' ? job.returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
  });
});

// GET /clientes - List clientes with pagination
/**
 * GET /clientes/por-vendedor
 *
 * Cuantos clientes trajo cada vendedor, para el desplegable de la vista y para
 * responder de un vistazo "¿cuantos clientes tiene fulano?".
 *
 * Un cliente cuenta para un vendedor si tiene AL MENOS UN pedido suyo. Como un
 * cliente puede haber comprado a varios, **la suma de la columna puede pasar del
 * total de clientes de la sucursal**. No es un descuadre: es que ese cliente lo
 * atienden dos.
 *
 * Va scopeado por sucursal como todo lo demas, y el Gestor solo ve lo suyo.
 */
router.get('/por-vendedor', async (req, res) => {
  try {
    const { where, error } = alcanceDeLectura(req);

    if (error) return res.status(400).json({ error });

    const soloSuyo = soloLoSuyo(req);

    const filas = await prisma.vendedor.findMany({
      where: {
        ...where,
        activo: true,
        ...(soloSuyo ? { gestorId: soloSuyo.gestorId } : {}),
      },
      select: {
        id: true,
        nombre: true,
        codigo: true,
        sucursal: { select: { nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    // Los clientes DISTINTOS de cada vendedor, en UNA consulta para todos. Uno
    // por vendedor serian decenas de idas y vueltas.
    const conteos = await prisma.pedido.groupBy({
      by: ['vendedorId'],
      where: {
        ...where,
        vendedorId: { in: filas.map((v) => v.id) },
        clienteId: { not: null },
      },
      _count: { clienteId: true },
    });

    // groupBy cuenta PEDIDOS, no clientes distintos: dos pedidos del mismo
    // cliente contarian dos veces. Por eso los distintos se piden aparte.
    // El filtro de sucursal va TAMBIEN aqui. Sin el, el conteo saldria de todas
    // las sucursales y un operador veria numeros que no son los suyos — la
    // misma fuga que estamos quitando en el resto de la aplicacion.
    const distintos = await prisma.$queryRaw<Array<{ vendedorId: string; clientes: bigint }>>(
      Prisma.sql`
        select "sellerId" as "vendedorId", count(distinct "clientId") as clientes
          from "Order"
         where "sellerId" is not null
           and "clientId" is not null
           ${where.sucursalId ? Prisma.sql`and "sucursalId" = ${where.sucursalId}` : Prisma.empty}
         group by 1`,
    );
    const porVendedor = new Map(distintos.map((d) => [d.vendedorId, Number(d.clientes)]));
    const pedidosPorVendedor = new Map(conteos.map((c) => [c.vendedorId, c._count.clienteId]));

    res.json(
      filas.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        codigo: v.codigo,
        sucursal: v.sucursal?.nombre ?? null,
        clientes: porVendedor.get(v.id) ?? 0,
        pedidos: pedidosPorVendedor.get(v.id) ?? 0,
      })),
    );
  } catch (err) {
    console.error('Error en clientes por vendedor:', err);
    res.status(500).json({ error: 'Error al obtener los clientes por vendedor' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string | undefined;

    const skip = (page - 1) * limit;

    const where: any = { sucursalId };
    // RBAC — rol GESTOR: SOLO los clientes de SUS pedidos (por su vendedor vinculado).
    const gestorCtx = getRequesterContext(req);
    if (gestorCtx.isGestor && gestorCtx.userId) {
      where.pedidos = { some: { vendedor: { gestorId: gestorCtx.userId } } };
    }
    // Filtros extra: municipio y estado de compra (Compra / No Compra). El scope de
    // sucursal ya lo aplicó resolveSucursalFilter según el rol y si eligió "Todas".
    const municipio = (req.query.municipio as string)?.trim();
    const estadoCompra = (req.query.estadoCompra as string)?.trim();
    if (municipio) where.municipio = municipio;
    if (estadoCompra) where.estadoCompra = estadoCompra;

    // Filtro por VENDEDOR: "los clientes que trajo fulano".
    //
    // No hay relacion directa cliente -> vendedor; la union son los pedidos. Un
    // cliente cuenta como de ese vendedor si tiene AL MENOS UN pedido suyo, que
    // es como lo entiende quien pregunta ("¿cuantos clientes tiene este
    // vendedor?"). Ojo: un cliente puede haber comprado a varios, asi que la
    // suma por vendedor puede pasar del total de clientes — y esta bien, no es
    // un error de cuentas.
    //
    // El scope de sucursal ya esta puesto arriba y NO se toca aqui: filtrar por
    // un vendedor de otra sucursal no puede enseñar sus clientes.
    /**
     * Filtros por DATO QUE FALTA: "enséñame los que no tienen teléfono".
     *
     * Es la pregunta que se hace de verdad cuando hay que completar fichas: no
     * "búscame a Fulano", sino "cuáles están incompletos y cuántos son". Sin esto,
     * la única forma de saberlo era ir pasando páginas a ojo.
     *
     * Cada uno trata el vacío igual que el nulo. En estos datos hay de los dos —lo
     * que llega del consolidado viene con cadenas vacías— y para quien mira la ficha
     * significan exactamente lo mismo: que ahí no hay nada.
     */
    const falta = (req.query.falta as string)?.trim();
    const VACIO = (campo: string) => ({ OR: [{ [campo]: null }, { [campo]: '' }] });
    const FALTANTES: Record<string, any> = {
      telefono: VACIO('telefono'),
      // La ubicación es la que impide cotizar el domicilio: sin ella no hay reparto.
      geo: { OR: [{ latitud: null }, { longitud: null }] },
      direccion: VACIO('direccion'),
      municipio: VACIO('municipio'),
      zona: VACIO('zona'),
      codigo: VACIO('codigo'),
    };
    if (falta && FALTANTES[falta]) Object.assign(where, FALTANTES[falta]);

    const vendedorId = (req.query.vendedorId as string)?.trim();

    if (vendedorId) {
      where.pedidos = where.pedidos
        ? { some: { AND: [where.pedidos.some, { vendedorId }] } }
        : { some: { vendedorId } };
    }
    const searchTerm = search?.trim().toUpperCase();

    if (searchTerm) {
      // Búsqueda por PALABRAS: el nombre debe contener TODAS las palabras buscadas,
      // sin importar cuántos espacios haya entre ellas. Así "MIVIALA RIVERO CONSUEGRA"
      // encuentra a "MIVIALA RIVERO  CONSUEGRA" (doble espacio, típico de estos datos).
      const palabras = searchTerm.split(/\s+/).filter(Boolean);
      where.OR = [
        { AND: palabras.map((w) => ({ nombre: { contains: w } })) },
        { codigo: { contains: searchTerm } },
        { zona: { contains: searchTerm } },
      ];
    }

    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        skip,
        take: limit,
        orderBy: { nombre: 'asc' },
      }),
      prisma.cliente.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    /**
     * Cuántos clientes le falta cada dato, con los MISMOS filtros que la lista.
     *
     * Van con el listado y no en otra llamada porque la pregunta es la misma: quien
     * ve "sin teléfono: 812" ya sabe si vale la pena entrar. Y respetan la sucursal y
     * el vendedor elegidos, que si no, el número diría una cosa y la lista otra.
     */
    const baseConteo = { ...where };
    delete (baseConteo as any).OR;   // el OR es del buscador y del filtro de faltantes
    const [sinTelefono, sinGeo, sinDireccion, sinMunicipio] = await Promise.all([
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.telefono } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.geo } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.direccion } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.municipio } }),
    ]);
    const faltantes = { telefono: sinTelefono, geo: sinGeo, direccion: sinDireccion, municipio: sinMunicipio };

    // Quién trajo a cada cliente: el vendedor de su pedido MÁS ANTIGUO. No hay
    // relación directa cliente->vendedor, la unión son los pedidos. Con los datos
    // actuales el 91% de los clientes tiene un solo vendedor (6918 de 7579), así
    // que para casi todos "el primero" es "el suyo"; para el resto se indica
    // cuántos más han trabajado con él.
    //
    // Se resuelve en UNA consulta para toda la página, no una por cliente: con
    // ~600 ms de latencia por petición, un N+1 aquí sería letal.
    const ids = clientes.map((c) => c.id);
    const porCliente = new Map<string, { vendedor: string | null; codigo: string | null; otros: number }>();

    if (ids.length > 0) {
      const pedidos = await prisma.pedido.findMany({
        where: { clienteId: { in: ids } },
        select: {
          clienteId: true,
          fecha: true,
          vendedor: { select: { nombre: true, codigo: true } },
        },
        orderBy: { fecha: 'asc' },
      });

      const vistos = new Map<string, Set<string>>();

      for (const p of pedidos) {
        if (!p.clienteId) continue;
        // El primero que aparece es el más antiguo: los pedidos vienen ordenados.
        if (!porCliente.has(p.clienteId)) {
          porCliente.set(p.clienteId, {
            vendedor: p.vendedor?.nombre ?? null,
            codigo: p.vendedor?.codigo ?? null,
            otros: 0,
          });
        }
        if (p.vendedor?.nombre) {
          if (!vistos.has(p.clienteId)) vistos.set(p.clienteId, new Set());
          vistos.get(p.clienteId)!.add(p.vendedor.nombre);
        }
      }
      // "otros" = cuántos vendedores MÁS, aparte del que lo trajo.
      for (const [cid, set] of vistos) {
        const e = porCliente.get(cid);

        if (e) e.otros = Math.max(0, set.size - 1);
      }
    }

    const clientesConVendedor = clientes.map((c) => ({
      ...c,
      vendedorNombre: porCliente.get(c.id)?.vendedor ?? null,
      vendedorCodigo: porCliente.get(c.id)?.codigo ?? null,
      otrosVendedores: porCliente.get(c.id)?.otros ?? 0,
    }));

    // Municipios distintos del scope actual (para poblar el dropdown del filtro).
    const municipiosRaw = await prisma.cliente.findMany({
      where: { sucursalId, municipio: { not: null } },
      select: { municipio: true }, distinct: ['municipio'], orderBy: { municipio: 'asc' },
    });

    res.json({
      data: clientesConVendedor,
      pagination: { page, limit, total, totalPages },
      municipios: municipiosRaw.map((m) => m.municipio).filter(Boolean),
      faltantes,
    });
  } catch (error) {
    console.error('Error fetching clientes:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// GET /clientes/:id - Get cliente details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursalId, error: sucursalError } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }

    const cliente = await prisma.cliente.findFirst({
      where: { id, sucursalId }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(cliente);
  } catch (error) {
    console.error('Error fetching cliente:', error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

export default router;
