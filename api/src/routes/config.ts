import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prismaClient';
import { getRequesterContext, requireSucursalId, resolveSucursalScope } from '../lib/sucursalContext';

const router = Router();
const CONFIG_FILE = path.join(__dirname, '../../config.json');

// Helper to read config
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
    return { sucursalId: null };
  } catch (err) {
    console.error('Error reading config:', err);
    return { sucursalId: null };
  }
}

// Helper to write config
function writeConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing config:', err);
    return false;
  }
}

// Get current configuration
router.get('/', async (req, res) => {
  try {
    const config = readConfig();
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update configuration
router.post('/', async (req, res) => {
  try {
    const { sucursalId } = req.body;
    const requester = getRequesterContext(req);
    const { sucursalId: allowedSucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: false,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });

    if (sucursalError) {
      return res.status(403).json({ error: sucursalError });
    }

    if (!sucursalId) {
      return res.status(400).json({ error: 'sucursalId is required' });
    }

    if (!requester.isGlobalAdmin && allowedSucursalId && sucursalId !== allowedSucursalId) {
      return res.status(403).json({ error: 'No puedes cambiar la configuración a otra sucursal.' });
    }

    const config = {
      sucursalId,
      updatedAt: new Date().toISOString(),
    };

    const success = writeConfig(config);

    if (!success) {
      return res.status(500).json({ error: 'Failed to save configuration' });
    }

    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Reset database - delete all data except users, roles and sucursales
router.delete('/reset-database', async (req, res) => {
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
