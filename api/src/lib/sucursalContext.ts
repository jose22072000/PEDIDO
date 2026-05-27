import { Request } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';

const CONFIG_FILE = path.join(__dirname, '../../config.json');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

interface TokenPayload {
  userId?: string;
  username?: string;
  roleId?: string;
  role?: string;
  sucursalId?: string | null;
}

interface RequesterContext {
  username?: string;
  role?: string;
  sucursalId?: string | null;
  isGlobalAdmin: boolean;
}

interface ResolveScopeOptions {
  allowAllForAdmin?: boolean;
  preferUserSucursal?: boolean;
  defaultAllForAdmin?: boolean;
}

type SucursalSelectionSource = 'body' | 'query' | 'header' | 'config' | null;

function resolveSucursalSelection(req: Request): { sucursalId: string | null; source: SucursalSelectionSource } {
  const bodySucursalId = typeof req.body?.sucursalId === 'string' ? req.body.sucursalId.trim() : '';
  if (bodySucursalId) return { sucursalId: bodySucursalId, source: 'body' };

  const querySucursalId = typeof req.query?.sucursalId === 'string' ? req.query.sucursalId.trim() : '';
  if (querySucursalId) return { sucursalId: querySucursalId, source: 'query' };

  const headerSucursalId = typeof req.headers['x-sucursal-id'] === 'string' ? req.headers['x-sucursal-id'].trim() : '';
  if (headerSucursalId) return { sucursalId: headerSucursalId, source: 'header' };

  const configuredSucursalId = readConfiguredSucursalId();
  if (configuredSucursalId) return { sucursalId: configuredSucursalId, source: 'config' };

  return { sucursalId: null, source: null };
}

function readConfiguredSucursalId(): string | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { sucursalId?: string | null };
    return parsed.sucursalId?.trim() || null;
  } catch {
    return null;
  }
}

function parseBearerToken(req: Request): TokenPayload | null {
  try {
    const authHeader = req.headers.authorization || (req.headers.Authorization as string | undefined);
    let token: string | undefined;

    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) return null;
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getRequesterContext(req: Request): RequesterContext {
  const payload = parseBearerToken(req);
  const role = payload?.role ? String(payload.role).toUpperCase() : undefined;
  const username = payload?.username;

  const isGlobalAdmin =
    String(username || '').toLowerCase() === 'admin' ||
    role === 'ADMINISTRADOR';

  return {
    username,
    role,
    sucursalId: payload?.sucursalId ?? null,
    isGlobalAdmin,
  };
}

export function resolveSucursalId(req: Request): string | null {
  return resolveSucursalSelection(req).sucursalId;
}

export function requireSucursalId(req: Request): { sucursalId?: string; error?: string } {
  const { sucursalId, error } = resolveSucursalScope(req, {
    allowAllForAdmin: false,
    preferUserSucursal: true,
  });

  if (error) {
    return { error };
  }

  if (!sucursalId) {
    return { error: 'No hay sucursal configurada. Envia sucursalId en body/query/header x-sucursal-id o configura /config.' };
  }

  return { sucursalId };
}

export function resolveSucursalScope(
  req: Request,
  options: ResolveScopeOptions = {},
): { sucursalId?: string | null; isGlobalAdmin: boolean; error?: string } {
  const {
    allowAllForAdmin = false,
    preferUserSucursal = true,
    defaultAllForAdmin = false,
  } = options;

  const requester = getRequesterContext(req);
  const selection = resolveSucursalSelection(req);
  let selectedSucursalId = selection.sucursalId;

  // For global admins, ignore implicit fallback from config.json unless sucursal
  // was explicitly provided in request context.
  if (requester.isGlobalAdmin && selection.source === 'config') {
    selectedSucursalId = null;
  }

  if (preferUserSucursal && requester.sucursalId && !selectedSucursalId) {
    selectedSucursalId = requester.sucursalId;
  }

  if (selectedSucursalId?.toLowerCase() === 'all') {
    if (allowAllForAdmin && requester.isGlobalAdmin) {
      return { sucursalId: null, isGlobalAdmin: true };
    }
    return {
      isGlobalAdmin: requester.isGlobalAdmin,
      error: 'Solo el administrador global puede consultar todas las sucursales.',
    };
  }

  if (
    requester.sucursalId &&
    selectedSucursalId &&
    selectedSucursalId !== requester.sucursalId &&
    !requester.isGlobalAdmin
  ) {
    return {
      isGlobalAdmin: false,
      error: 'No tienes permiso para operar otra sucursal.',
    };
  }

  if (requester.isGlobalAdmin && defaultAllForAdmin && !selectedSucursalId) {
    return { sucursalId: null, isGlobalAdmin: true };
  }

  if (requester.sucursalId && !selectedSucursalId) {
    selectedSucursalId = requester.sucursalId;
  }

  return { sucursalId: selectedSucursalId, isGlobalAdmin: requester.isGlobalAdmin };
}
