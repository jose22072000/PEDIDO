import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prismaClient';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.usuario.findMany({
      include: {
        rol: true,
        sucursal: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Remove password from response
    const usersWithoutPassword = users.map(({ password, ...user }) => user);

    res.json(usersWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.usuario.findUnique({
      where: { id },
      include: {
        rol: true,
        sucursal: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    res.json(userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    const { username, password, rolId, sucursalId } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if username already exists
    const existingUser = await prisma.usuario.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.usuario.create({
      data: {
        username,
        password: hashedPassword,
        rolId: rolId || null,
        sucursalId: sucursalId || null,
      },
      include: {
        rol: true,
        sucursal: true,
      },
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json(userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, rolId, sucursalId } = req.body;

    const updateData: any = {};

    if (username) updateData.username = username;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (rolId !== undefined) updateData.rolId = rolId;
    if (sucursalId !== undefined) updateData.sucursalId = sucursalId;

    const user = await prisma.usuario.update({
      where: { id },
      data: updateData,
      include: {
        rol: true,
        sucursal: true,
      },
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json(userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.usuario.delete({
      where: { id },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
