import { Router } from 'express';
import { NextFunction, Response } from 'express';
import prisma from '../prismaClient';
import { requireSucursalId } from '../lib/sucursalContext';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  const username = String(req.user?.username || '').toLowerCase();
  const role = String(req.user?.role || '').toUpperCase();
  const isAdmin = username === 'admin' || role === 'ADMINISTRADOR';

  if (!isAdmin) {
    return res.status(403).json({ error: 'Solo los administradores pueden acceder a configuracion.' });
  }

  next();
};

router.use(authenticateToken, requireAdmin);

// Get current configuration
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      mode: 'user-scoped',
      sucursalId: req.user?.sucursalId || null,
      message: 'La sucursal se determina automaticamente por el usuario autenticado.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Global sucursal config removed (kept route for backwards compatibility)
router.post('/', async (_req: AuthRequest, res: Response) => {
  return res.status(410).json({
    error: 'La configuracion global de sucursal fue eliminada. Ahora se usa automaticamente la sucursal del usuario.',
  });
});

// Reset database - delete all data except users, roles and sucursales
router.delete('/reset-database', async (req: AuthRequest, res: Response) => {
  try {
    const { sucursalId, error: sucursalError } = requireSucursalId(req);
    if (sucursalError || !sucursalId) {
      return res.status(400).json({ error: sucursalError });
    }

    const pedidosSucursal = await prisma.pedido.findMany({
      where: { sucursalId },
      select: { id: true },
    });
    const orderIds = pedidosSucursal.map((p) => p.id);

    // Delete in order to respect foreign key constraints
    // Keep: usuarios, roles, sucursales
    if (orderIds.length > 0) {
      await prisma.pedidoItem.deleteMany({
        where: { pedidoId: { in: orderIds } },
      });
    }
    await prisma.pedido.deleteMany({ where: { sucursalId } });
    await prisma.cliente.deleteMany({ where: { sucursalId } });
    await prisma.vendedor.deleteMany({ where: { sucursalId } });

    res.json({ success: true, message: 'Base de datos de la sucursal borrada correctamente' });
  } catch (err) {
    console.error('Error resetting database:', err);
    res.status(500).json({ error: 'Error al borrar la base de datos' });
  }
});

export default router;
