import express from 'express';
import prisma from '../prismaClient';
import { resolveSucursalFilter, getRequesterContext } from '../lib/sucursalContext';
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
      const [completos, fallidos, activos] = await Promise.all([
        q.getJobs(['completed'], 0, 15),
        q.getJobs(['failed'], 0, 5),
        q.getJobs(['active', 'waiting', 'delayed'], 0, 5),
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

    res.json({
      data: clientes,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
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
