import { Request } from 'express';
import jwt from 'jsonwebtoken';

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
  /** Ve TODAS las sucursales. Solo el Super Admin. */
  isGlobalAdmin: boolean;
  isSuperAdmin: boolean;
  /** Puede entrar a Usuarios (Super Admin o Administrador). */
  canManageUsers: boolean;
}

interface ResolveScopeOptions {
  allowAllForAdmin?: boolean;
  preferUserSucursal?: boolean;
  defaultAllForAdmin?: boolean;
}

type SucursalSelectionSource = 'body' | 'query' | 'header' | null;

function resolveSucursalSelection(req: Request): { sucursalId: string | null; source: SucursalSelectionSource } {
  const bodySucursalId = typeof req.body?.sucursalId === 'string' ? req.body.sucursalId.trim() : '';
  if (bodySucursalId) return { sucursalId: bodySucursalId, source: 'body' };

  const querySucursalId = typeof req.query?.sucursalId === 'string' ? req.query.sucursalId.trim() : '';
  if (querySucursalId) return { sucursalId: querySucursalId, source: 'query' };

  const headerSucursalId = typeof req.headers['x-sucursal-id'] === 'string' ? req.headers['x-sucursal-id'].trim() : '';
  if (headerSucursalId) return { sucursalId: headerSucursalId, source: 'header' };

  return { sucursalId: null, source: null };
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

  // "Super Admin" es el ÚNICO rol global: ve todas las sucursales y es el único que
  // puede crear otros Super Admin. Se conserva el usuario semilla `admin` como Super
  // Admin para no quedarse sin acceso al desplegar este cambio.
  const isSuperAdmin =
    role === 'SUPER ADMIN' || String(username || '').toLowerCase() === 'admin';

  // OJO: antes "ver todas las sucursales" y "gestionar usuarios" eran LO MISMO
  // (isGlobalAdmin incluía a ADMINISTRADOR). Ahora se separan: el Administrador queda
  // scopeado a SU sucursal, pero sigue pudiendo gestionar los usuarios de ella.
  const isGlobalAdmin = isSuperAdmin;
  const canManageUsers = isSuperAdmin || role === 'ADMINISTRADOR';

  return {
    username,
    role,
    sucursalId: payload?.sucursalId ?? null,
    isGlobalAdmin,
    isSuperAdmin,
    canManageUsers,
  };
}

export function resolveSucursalId(req: Request): string | null {
  return resolveSucursalSelection(req).sucursalId;
}

/**
 * Para endpoints de LECTURA. Devuelve la sucursal por la que filtrar.
 *
 * El Super Admin es global y NO tiene sucursal: en ese caso devuelve `undefined` y la
 * consulta no filtra -> ve TODAS las sucursales (Prisma ignora un `where` undefined).
 * Cualquier otro usuario debe tener la suya, como siempre.
 *
 * Los endpoints de ESCRITURA siguen usando requireSucursalId: nunca se crea nada sin
 * saber a qué sucursal pertenece.
 */
export function resolveSucursalFilter(req: Request): { sucursalId?: string; error?: string } {
  const { sucursalId, error } = resolveSucursalScope(req, {
    allowAllForAdmin: true,
    preferUserSucursal: true,
    defaultAllForAdmin: true,
  });

  if (error) return { error };

  if (!sucursalId && !getRequesterContext(req).isGlobalAdmin) {
    return {
      error: 'No hay sucursal disponible para esta solicitud. Inicia sesion con un usuario asignado a sucursal o envia sucursalId en body/query/header x-sucursal-id.',
    };
  }

  return { sucursalId: sucursalId ?? undefined };
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
    return { error: 'No hay sucursal disponible para esta solicitud. Inicia sesion con un usuario asignado a sucursal o envia sucursalId en body/query/header x-sucursal-id.' };
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

  // Un usuario NO global solo puede operar SU sucursal. Se comprueba también cuando
  // no tiene sucursal propia (requester.sucursalId null): si no, bastaría con mandar
  // el header x-sucursal-id para operar cualquier sucursal.
  if (
    !requester.isGlobalAdmin &&
    selectedSucursalId &&
    selectedSucursalId !== requester.sucursalId
  ) {
    return {
      isGlobalAdmin: false,
      error: requester.sucursalId
        ? 'No tienes permiso para operar otra sucursal.'
        : 'Tu usuario no tiene sucursal asignada. Pide a un Super Admin que te asigne una.',
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
