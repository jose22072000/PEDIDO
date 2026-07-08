import express from 'express';
import prisma from '../prismaClient';
import { resolveSucursalFilter } from '../lib/sucursalContext';

const router = express.Router();

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
