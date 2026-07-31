import { Router, Response } from 'express';
import prisma from '../prismaClient';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { generateApiKey } from '../lib/apiKey';
import { getRequesterContext } from '../lib/sucursalContext';
import { emitEvent } from '../lib/events';

// Gestión de API keys para otros proyectos/compañeros. SOLO el Super Admin. El token en
// claro (pk_...) se muestra UNA sola vez al crear; después solo queda el hash + el uso.
const router = Router();
router.use(authenticateToken);

function requireSuperAdmin(req: AuthRequest, res: Response): boolean {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) {
    res.status(403).json({ error: 'Solo el Super Admin puede gestionar API keys.' });
    return false;
  }
  return true;
}

function maskKey(k: any) {
  // Nunca se expone el hash ni el token.
  return {
    id: k.id,
    label: k.label,
    prefix: k.prefix,
    scope: k.scope,
    activo: k.activo,
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    usageCount: k.usageCount,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  };
}

// GET /api-keys — lista enmascarada + uso (quién entra/sale).
router.get('/', async (req: AuthRequest, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(keys.map(maskKey));
});

// POST /api-keys — crea y devuelve el token EN CLARO una sola vez.
router.post('/', async (req: AuthRequest, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Falta el nombre (label) del proyecto.' });
  const scope = ['integration', 'read', 'full'].includes(req.body?.scope) ? req.body.scope : 'integration';
  let expiresAt: Date | null = null;
  if (req.body?.expiresAt) {
    const d = new Date(req.body.expiresAt);
    if (!isNaN(d.getTime())) expiresAt = d;
  }
  const { token, prefix, tokenHash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { label, prefix, tokenHash, scope, expiresAt, createdById: req.user?.userId || null },
  });
  emitEvent('apikey', { id: created.id, accion: 'create' });
  // El token solo se ve AHORA; guárdalo. Después solo queda el hash.
  res.status(201).json({ ...maskKey(created), token });
});

// POST /api-keys/:id/revoke — revoca (no borra: conserva el historial de uso).
router.post('/:id/revoke', async (req: AuthRequest, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key) return res.status(404).json({ error: 'API key no encontrada.' });
  const updated = await prisma.apiKey.update({
    where: { id: req.params.id },
    data: { activo: false, revokedAt: new Date() },
  });
  emitEvent('apikey', { id: updated.id, accion: 'update' });
  res.json(maskKey(updated));
});

// DELETE /api-keys/:id — borra definitivamente.
router.delete('/:id', async (req: AuthRequest, res) => {
  if (!requireSuperAdmin(req, res)) return;
  await prisma.apiKey.delete({ where: { id: req.params.id } }).catch(() => {});
  emitEvent('apikey', { id: req.params.id, accion: 'delete' });
  res.json({ ok: true });
});

export default router;
