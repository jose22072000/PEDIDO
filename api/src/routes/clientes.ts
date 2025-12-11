import express from 'express';
import prisma from '../prismaClient';

const router = express.Router();

// GET /clientes - List clientes with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';

    const skip = (page - 1) * limit;

    let whereClause: any = {};

    // Search by nombre, codigo (parrandaId), or zona
    if (search) {
      whereClause = {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' } },
          { codigo: { contains: search, mode: 'insensitive' } },
          { zona: { contains: search, mode: 'insensitive' } }
        ]
      };
    }

    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { nombre: 'asc' }
      }),
      prisma.cliente.count({ where: whereClause })
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

    const cliente = await prisma.cliente.findUnique({
      where: { id }
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
