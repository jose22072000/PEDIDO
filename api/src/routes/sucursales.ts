import { Router } from 'express';
import prisma from '../prismaClient';

const router = Router();

// Get all sucursales
router.get('/', async (req, res) => {
  try {
    const sucursales = await prisma.sucursal.findMany({
      orderBy: {
        nombre: 'asc',
      },
    });

    res.json(sucursales);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sucursales' });
  }
});

// Get sucursal by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const sucursal = await prisma.sucursal.findUnique({
      where: { id },
      include: {
        usuarios: {
          select: {
            id: true,
            username: true,
            rol: true,
          },
        },
      },
    });

    if (!sucursal) {
      return res.status(404).json({ error: 'Sucursal not found' });
    }

    res.json(sucursal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sucursal' });
  }
});

// Create new sucursal
router.post('/', async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'Sucursal name is required' });
    }

    const sucursal = await prisma.sucursal.create({
      data: {
        nombre,
      },
    });

    res.status(201).json(sucursal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create sucursal' });
  }
});

// Update sucursal
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    const sucursal = await prisma.sucursal.update({
      where: { id },
      data: {
        nombre,
      },
    });

    res.json(sucursal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update sucursal' });
  }
});

// Delete sucursal
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.sucursal.delete({
      where: { id },
    });

    res.json({ message: 'Sucursal deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete sucursal' });
  }
});

export default router;
