// `import type` (no `import`): Request es SOLO un tipo. Escrito como import normal,
// cualquier ejecución sin compilar —los tests, por ejemplo— intenta importarlo de
// verdad de express, que al ser CommonJS no exporta nada con ese nombre y revienta.
import type { Request } from 'express';
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
  userId?: string;
  username?: string;
  role?: string;
  sucursalId?: string | null;
  /** Ve TODAS las sucursales. Solo el Super Admin. */
  isGlobalAdmin: boolean;
  /** Puede dar de alta/baja vendedores y enlazarlos a un gestor. */
  puedeGestionarVendedores: boolean;
  isSuperAdmin: boolean;
  /** Puede entrar a Usuarios (Super Admin o Administrador). */
  canManageUsers: boolean;
  /**
   * Puede METER datos (subir el CSV) y SACAR informes.
   *
   * El Operador no: factura con los pedidos que ya están subidos, y para eso le
   * basta con leer. Subir un CSV equivocado o sacar informes de la sucursal no
   * son cosa suya.
   */
  puedeImportarYReportar: boolean;
  /** Rol Gestor: SOLO ve SUS datos (sus pedidos/clientes), nada de compañeros. */
  isGestor: boolean;
}

interface ResolveScopeOptions {
  allowAllForAdmin?: boolean;
  preferUserSucursal?: boolean;
  defaultAllForAdmin?: boolean;
}

type SucursalSelectionSource = 'body' | 'query' | 'header' | null;

// Valores que NO son un id de sucursal sino "todas". El front usa '__todas__'
// como valor del desplegable y, al elegirlo, borra la clave de localStorage —
// pero un navegador que ya la tenía guardada de antes la sigue mandando. Sin
// esta lista, ese texto se buscaba como si fuera un id real: no encontraba
// ninguna sucursal y devolvía CERO filas, con lo que el Super Admin veía la
// pantalla vacía y sin ningún error que lo explicara.
const CENTINELAS_TODAS = new Set(['all', 'todas', '__todas__', '*', 'null', 'undefined']);

/** Normaliza el valor recibido: los centinelas de "todas" pasan a null. */
function limpiarSeleccion(valor: string): string | null {
  const v = valor.trim();

  return v && !CENTINELAS_TODAS.has(v.toLowerCase()) ? v : null;
}

function resolveSucursalSelection(req: Request): { sucursalId: string | null; source: SucursalSelectionSource } {
  const bodySucursalId = typeof req.body?.sucursalId === 'string' ? limpiarSeleccion(req.body.sucursalId) : null;
  if (bodySucursalId) return { sucursalId: bodySucursalId, source: 'body' };

  const querySucursalId = typeof req.query?.sucursalId === 'string' ? limpiarSeleccion(req.query.sucursalId) : null;
  if (querySucursalId) return { sucursalId: querySucursalId, source: 'query' };

  const headerSucursalId = typeof req.headers['x-sucursal-id'] === 'string' ? limpiarSeleccion(req.headers['x-sucursal-id']) : null;
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
    } else if (typeof req.query?.token === 'string' && req.query.token) {
      // EventSource (SSE) no puede mandar headers: el token viaja como ?token=.
      // Sin esto, el stream del Super Admin (sin sucursal) no reconocía el token y
      // devolvía 400 -> el indicador se quedaba en "Conectando…" para siempre.
      token = req.query.token as string;
    }

    if (!token) return null;
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getRequesterContext(req: Request): RequesterContext {
  // API key (x-api-key) validada por el middleware apiKeyAuth (solo en GET/HEAD):
  // identidad GLOBAL de lectura → ve TODAS las sucursales (sucursalId=all funciona),
  // pero sin gestión de usuarios ni privilegios de super admin.
  const apiKeyCtx = (req as unknown as { apiKeyCtx?: { id: string; label: string } }).apiKeyCtx;
  if (apiKeyCtx) {
    return {
      userId: `apikey:${apiKeyCtx.id}`,
      username: apiKeyCtx.label,
      role: 'SUPER ADMIN',
      sucursalId: null,
      isGlobalAdmin: true,
      isSuperAdmin: false,
      canManageUsers: false,
      isGestor: false,
      puedeGestionarVendedores: false,
      puedeImportarYReportar: true,
    };
  }

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
  const isGestor = role === 'GESTOR';
  // Quien puede TOCAR vendedores: darlos de alta/baja y enlazarlos a un gestor.
  // El Operador NO: factura, y para eso solo necesita LEER la lista y copiar el
  // codigo al portapapeles. Dejarle escribir seria darle de baja a un vendedor
  // por un mal clic mientras trabaja.
  const puedeGestionarVendedores =
    isSuperAdmin || role === 'ADMINISTRADOR' || role === 'SUPERVISOR';

  // El Operador queda fuera: entra a leer y a copiar codigos para facturar.
  // Ocultarle los botones en la pantalla no es proteccion — esta comprobacion,
  // si.
  const puedeImportarYReportar = role !== 'OPERADOR';

  return {
    userId: payload?.userId,
    username,
    role,
    sucursalId: payload?.sucursalId ?? null,
    isGlobalAdmin,
    isSuperAdmin,
    canManageUsers,
    isGestor,
    puedeGestionarVendedores,
    puedeImportarYReportar,
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

/**
 * A qué datos llega quien pide. UNA sola decisión, para todo.
 *
 * # Por qué existe
 *
 * Había TRES formas de decidir el alcance (`resolveSucursalFilter`,
 * `requireSucursalId`, `resolveSucursalScope`) repartidas por nueve ficheros de
 * rutas, y cada ruta nueva elegía una a ojo. Eso no es un detalle de estilo: es
 * la causa directa de fallos que se repiten.
 *
 * El 07/08/2026 la lista de pedidos usaba una y completar usaba otra. Al Super
 * Admin la lista le devolvía TODAS las sucursales; completar le exigía una
 * concreta, y él no tiene sucursal propia. Resultado: **seis personas** (`admin`,
 * `amado`, `claudia.hab`, `julian`, `rene`, `shanel`) veían todos los pedidos y
 * no podían completar ninguno. El mensaje era "Error al completar el pedido",
 * así que parecía cosa del pedido y no de quién lo pulsaba.
 *
 * # La regla
 *
 * **Si se puede ver, se puede tocar. Si no se puede tocar, no se debería poder
 * ver.** Leer y escribir usan LA MISMA función — no dos funciones parecidas que
 * alguien tenga que acordarse de mantener iguales. `alcanceDeEscritura` ES
 * `alcanceDeLectura`; están enlazadas a propósito para que no puedan separarse.
 *
 * # Cómo se usa
 *
 *   const { where, error } = alcanceDeLectura(req);   // listar
 *   const { where, error } = alcanceDeEscritura(req); // completar, borrar
 *   const { sucursalId, error } = sucursalParaCrear(req); // crear algo nuevo
 *
 * `where` sale listo para Prisma: `{}` significa "todas las sucursales" y solo
 * le toca al Super Admin sin ninguna enfocada.
 */

export interface Alcance {
  /** Filtro listo para Prisma. `{}` = todas las sucursales. */
  where: { sucursalId?: string };
  /** La sucursal enfocada, o null si son todas. */
  sucursalId: string | null;
  isGlobalAdmin: boolean;
  /** Mensaje para el usuario si no se puede resolver. */
  error?: string;
}

/**
 * El alcance de quien pide.
 *
 * - Super Admin sin sucursal enfocada -> todas (`where` vacío).
 * - Super Admin con una elegida -> solo esa.
 * - Cualquier otro -> SIEMPRE la suya, aunque mande otra en la cabecera.
 * - Sin sucursal y sin ser global -> error. Nunca "todas": eso sería dejarle
 *   ver los datos de sucursales que no son suyas.
 */
export function alcanceDeLectura(req: Request): Alcance {
  const { sucursalId, isGlobalAdmin, error } = resolveSucursalScope(req, {
    allowAllForAdmin: true,
    preferUserSucursal: true,
    defaultAllForAdmin: true,
  });

  if (error) return { where: {}, sucursalId: null, isGlobalAdmin, error };

  if (!sucursalId) {
    if (isGlobalAdmin) return { where: {}, sucursalId: null, isGlobalAdmin: true };

    return {
      where: {},
      sucursalId: null,
      isGlobalAdmin: false,
      error:
        'Tu usuario no tiene sucursal asignada. Pide a un Super Admin que te asigne una.',
    };
  }

  return { where: { sucursalId }, sucursalId, isGlobalAdmin };
}

/**
 * El alcance para MODIFICAR. Es exactamente el mismo que para leer.
 *
 * No es una copia ni una función parecida: es la misma. Si algún día hicieran
 * falta reglas distintas para escribir, tendrán que escribirse aquí y con una
 * prueba que diga por qué — porque separarlas en silencio es lo que rompió esto.
 */
export const alcanceDeEscritura = alcanceDeLectura;

/**
 * La sucursal concreta a la que va algo que se CREA.
 *
 * Aquí sí hace falta una sola, y "todas" no vale: un pedido nuevo tiene que
 * nacer en una sucursal. Si el Super Admin no tiene ninguna enfocada, se le dice
 * qué hacer en vez de darle un error que no explica nada.
 */
export function sucursalParaCrear(req: Request): { sucursalId?: string; error?: string } {
  const { sucursalId, isGlobalAdmin, error } = alcanceDeLectura(req);

  if (error) return { error };
  if (sucursalId) return { sucursalId };

  return {
    error: isGlobalAdmin
      ? 'Elige una sucursal en el selector de arriba antes de crear.'
      : 'Tu usuario no tiene sucursal asignada. Pide a un Super Admin que te asigne una.',
  };
}

/**
 * ¿Este usuario solo puede ver LO SUYO?
 *
 * El rol Gestor ve únicamente los datos de los vendedores que lleva, ni siquiera
 * los de sus compañeros de sucursal. Va aparte del alcance por sucursal porque
 * es otra dimensión: una acota el SITIO, esta acota la PERSONA.
 */
export function soloLoSuyo(req: Request): { gestorId: string } | null {
  const ctx = getRequesterContext(req);

  return ctx.isGestor && ctx.userId ? { gestorId: ctx.userId } : null;
}
