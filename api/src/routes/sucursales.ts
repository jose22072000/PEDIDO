import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';

const router = Router();

// El código (CAM, STG, ...) enlaza esta sucursal con el delivery (Branch.externalId)
// y con el consolidado de geolocalización. Se normaliza en MAYÚSCULAS sin espacios.
const normCodigo = (v: unknown): string | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return s ? s : null;
};

// Crear/editar/borrar sucursales es SOLO del Super Admin (es estructura del sistema).
function soloSuperAdmin(req: any, res: any): boolean {
  if (!getRequesterContext(req).isSuperAdmin) {
    res.status(403).json({ error: 'Solo el Super Admin puede gestionar sucursales.' });
    return false;
  }
  return true;
}

// Get all sucursales. El Super Admin ve todas; cualquier otro usuario ve SOLO la suya
// (para no filtrar ni nombres de otras sucursales).
router.get('/', async (req, res) => {
  try {
    const ctx = getRequesterContext(req);
    const where = ctx.isSuperAdmin
      ? {}
      : { id: ctx.sucursalId ?? '__ninguna__' };
    const sucursales = await prisma.sucursal.findMany({ where, orderBy: { nombre: 'asc' } });
    res.json(sucursales);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sucursales' });
  }
});

// Get sucursal by ID. Devuelve los USUARIOS de la sucursal, así que solo el Super Admin
// (o el propio usuario de esa sucursal) puede consultarla.
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ctx = getRequesterContext(req);
    if (!ctx.isSuperAdmin && ctx.sucursalId !== id) {
      return res.status(403).json({ error: 'No puedes ver otra sucursal.' });
    }
    const sucursal = await prisma.sucursal.findUnique({
      where: { id },
      include: {
        usuarios: { select: { id: true, username: true, rol: true } },
      },
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal not found' });
    res.json(sucursal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sucursal' });
  }
});

// Create new sucursal
router.post('/', async (req, res) => {
  try {
    if (!soloSuperAdmin(req, res)) return;
    const { nombre, codigo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const sucursal = await prisma.sucursal.create({
      data: { nombre: String(nombre).trim(), codigo: normCodigo(codigo) },
    });
    res.status(201).json(sucursal);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una sucursal con ese código.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create sucursal' });
  }
});

// Update sucursal
router.patch('/:id', async (req, res) => {
  try {
    if (!soloSuperAdmin(req, res)) return;
    const { id } = req.params;
    const { nombre, codigo } = req.body;

    const sucursal = await prisma.sucursal.update({
      where: { id },
      data: {
        ...(nombre !== undefined && { nombre: String(nombre).trim() }),
        ...(codigo !== undefined && { codigo: normCodigo(codigo) }),
      },
    });
    res.json(sucursal);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una sucursal con ese código.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update sucursal' });
  }
});

// Delete sucursal
router.delete('/:id', async (req, res) => {
  try {
    if (!soloSuperAdmin(req, res)) return;
    const { id } = req.params;
    await prisma.sucursal.delete({ where: { id } });
    res.json({ message: 'Sucursal deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete sucursal' });
  }
});

export default router;
