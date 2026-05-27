import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prismaClient';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

// Login endpoint
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user by username
    const user = await prisma.usuario.findUnique({
      where: { username },
      include: { rol: true, sucursal: true },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        roleId: user.rolId,
        role: user.rol?.nombre,
        sucursalId: user.sucursalId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return token + user info (frontend will store token and use Bearer auth)
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.rol?.nombre,
        sucursalId: user.sucursalId,
        sucursal: user.sucursal?.nombre,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', (req: Request, res: Response) => {
  // With Bearer tokens logout is a client-side action (drop token).
  // Keep clearing cookie if it exists for backwards compatibility.
  res.clearCookie && res.clearCookie('token');
  return res.json({ message: 'Logged out successfully' });
});

// Get current user endpoint (protected)
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.usuario.findUnique({
      where: { id: req.user?.userId },
      select: {
        id: true,
        username: true,
        rolId: true,
        sucursalId: true,
        rol: {
          select: {
            nombre: true,
          },
        },
        sucursal: {
          select: {
            nombre: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.rol?.nombre,
        sucursalId: user.sucursalId,
        sucursal: user.sucursal?.nombre,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
