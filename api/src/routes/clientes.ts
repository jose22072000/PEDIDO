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
