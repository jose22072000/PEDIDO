import { Router } from 'express';
import prisma from '../prismaClient';

const router = Router();

// Get all roles
router.get('/', async (req, res) => {
  try {
    const roles = await prisma.rol.findMany({
      orderBy: {
        nombre: 'asc',
      },
    });

    res.json(roles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Get role by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const role = await prisma.rol.findUnique({
      where: { id },
    });

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json(role);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Create new role
router.post('/', async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const role = await prisma.rol.create({
      data: {
        nombre,
      },
    });

    res.status(201).json(role);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// Delete role
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.rol.delete({
      where: { id },
    });

    res.json({ message: 'Role deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
