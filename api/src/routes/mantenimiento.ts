import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import fs from 'fs';
import multer from 'multer';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';
import { invalidarWebhookCache, entregarWebhook, getConfig, type Destino } from '../lib/webhook';
import { webhooksQueue } from '../lib/queues';
import { encolarPendientesDeDomicilio } from '../lib/domicilio';
import { resumenLatencias } from '../lib/redis';

const upload = multer({ dest: 'uploads/temp' });
const fecha = (v: unknown) => (v == null ? null : new Date(v as string));

/**
 * Acciones de mantenimiento que antes solo se hacían por consola. Ahora se disparan
 * desde Configuración (UI). TODAS son SOLO del Super Admin y quedan REGISTRADAS
 * (quién, qué, cuándo) — nada oculto: si algo se rompe, se sabe qué pasó.
 */
const router = Router();

// Guard: solo Super Admin.
router.use((req, res, next) => {
  if (!getRequesterContext(req).isSuperAdmin) {
    return res.status(403).json({ error: 'Solo el Super Admin puede ejecutar mantenimiento.' });
  }
  next();
});

// Registro simple de auditoría (a stdout -> logs de PM2). Deja rastro de cada acción.
function auditar(req: any, accion: string, extra: Record<string, unknown> = {}) {
  const quien = getRequesterContext(req).username || '?';
  console.log(`[MANTENIMIENTO] ${new Date().toISOString()} · ${quien} · ${accion} · ${JSON.stringify(extra)}`);
}

// Jobs en memoria para operaciones LARGAS (restore / import-sqlite): procesan miles de
// filas y tardan MÁS que el timeout del proxy (60s) -> se responde 202 + jobId y se
// procesa en 2do plano; el front consulta GET /mantenimiento/job/:jobId. (El api es una
// sola instancia, así que un Map en memoria alcanza.)
type JobEstado = 'pendiente' | 'completado' | 'error';
const _jobs = new Map<string, { estado: JobEstado; tipo: string; resultado?: unknown; error?: string; cuando: number }>();
function jobsSet(id: string, patch: Partial<{ estado: JobEstado; tipo: string; resultado: unknown; error: string }>) {
  const prev = _jobs.get(id);
  _jobs.set(id, { estado: 'pendiente', tipo: '', ...prev, ...patch, cuando: Date.now() });
  if (_jobs.size > 50) {
    const viejo = [..._jobs.entries()].sort((a, b) => a[1].cuando - b[1].cuando)[0];
    if (viejo) _jobs.delete(viejo[0]);
  }
}
async function runBg(id: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    jobsSet(id, { resultado: await fn(), estado: 'completado' });
  } catch (e) {
    console.error('[MANTENIMIENTO] job', id, 'falló:', e);
    jobsSet(id, { estado: 'error', error: e instanceof Error ? e.message : 'Error' });
  }
}

// GET /mantenimiento/job/:jobId -> estado de una operación larga (pendiente/completado/error).
router.get('/job/:jobId', (req, res) => {
  const j = _jobs.get(req.params.jobId);
  if (!j) return res.json({ jobId: req.params.jobId, estado: 'desconocido' });
  res.json({ jobId: req.params.jobId, ...j });
});

// -------- Webhooks: config editable por el SUPER ADMIN desde la UI (NO por .env) --------
// Dos destinos, la misma tabla y la misma pantalla:
//   parranda  -> aviso de "pedido completado".
//   domicilio -> la APK. Ida (hay que cotizar) y vuelta (el secret con el que se
//                verifica lo que nos devuelven).
//
// Que se edite aquí y no en el .env es lo que permite cambiar la URL o rotar el secret
// sin volver a desplegar, que es justo lo que hace falta el día que se rota de verdad.

const DESTINOS = new Set<Destino>(['parranda', 'domicilio']);
function destinoDe(req: any): Destino | null {
  const d = String(req.params.destino || 'parranda') as Destino;
  return DESTINOS.has(d) ? d : null;
}

// GET: la config. El secret NUNCA se devuelve, sólo si existe.
async function leerConfig(req: any, res: any) {
  const destino = destinoDe(req);
  if (!destino) return res.status(404).json({ error: 'Destino desconocido.' });
  try {
    const row = await prisma.webhookConfig.findUnique({ where: { id: destino } });
    res.json({
      destino,
      url: row?.url || '',
      key: row?.apiKey || '',
      activo: row?.activo ?? true,
      tieneSecret: !!row?.secret,
      actualizado: row?.updatedAt ?? null,
    });
  } catch (err) {
    console.error('webhook get error:', err);
    res.status(500).json({ error: 'No se pudo leer la config del webhook.' });
  }
}

// PUT: guarda. El secret sólo se toca si mandan uno nuevo (vacío = dejarlo como está),
// para que guardar la URL no borre el secret sin querer.
async function guardarConfig(req: any, res: any) {
  const destino = destinoDe(req);
  if (!destino) return res.status(404).json({ error: 'Destino desconocido.' });
  try {
    const { url, key, secret, activo } = (req.body || {}) as { url?: string; key?: string; secret?: string; activo?: boolean };
    const data: Record<string, unknown> = {
      url: (url ?? '').trim() || null,
      apiKey: (key ?? '').trim() || null,
      activo: activo !== false,
    };
    if (typeof secret === 'string' && secret.trim()) data.secret = secret.trim();
    await prisma.webhookConfig.upsert({ where: { id: destino }, update: data, create: { id: destino, ...data } });
    invalidarWebhookCache(destino);
    auditar(req, 'webhook-config', { destino, url: data.url, activo: data.activo, cambioSecret: !!data.secret });
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook put error:', err);
    res.status(500).json({ error: 'No se pudo guardar la config del webhook.' });
  }
}

router.get('/webhook', leerConfig);            // sin destino = parranda (como siempre)
router.put('/webhook', guardarConfig);
router.get('/webhook/:destino', leerConfig);
router.put('/webhook/:destino', guardarConfig);

/**
 * POST /mantenimiento/webhook/:destino/secret
 * Genera un secret y lo devuelve UNA vez, para copiárselo al del otro extremo.
 *
 * Lo genera el servidor y no la persona porque un secret escrito a mano acaba siendo
 * "procovar2026": 32 bytes de azar no se adivinan ni se reutilizan de otro sitio.
 */
router.post('/webhook/:destino/secret', async (req, res) => {
  const destino = destinoDe(req);
  if (!destino) return res.status(404).json({ error: 'Destino desconocido.' });
  const secret = randomBytes(32).toString('hex');
  await prisma.webhookConfig.upsert({
    where: { id: destino },
    update: { secret },
    create: { id: destino, secret },
  });
  invalidarWebhookCache(destino);
  auditar(req, 'webhook-secret-nuevo', { destino });
  // Se devuelve en claro AQUÍ y sólo aquí: es el único momento en que se puede copiar.
  res.json({ ok: true, secret });
});

/**
 * POST /mantenimiento/webhook/:destino/probar
 * Manda un aviso de prueba a la URL configurada y cuenta qué contestó. Sirve para saber
 * si el problema es de configuración ANTES de que haya pedidos de verdad esperando.
 */
router.post('/webhook/:destino/probar', async (req, res) => {
  const destino = destinoDe(req);
  if (!destino) return res.status(404).json({ error: 'Destino desconocido.' });
  const cfg = await getConfig(destino);
  if (!cfg.url) return res.status(400).json({ error: 'No hay URL configurada.' });
  if (!cfg.activo) return res.status(400).json({ error: 'El webhook está desactivado.' });

  const inicio = Date.now();
  try {
    await entregarWebhook(destino, {
      evento: 'prueba',
      destino,
      mensaje: 'Prueba desde PEDIDO. Si ves esto, la URL y la firma están bien.',
      en: new Date().toISOString(),
    });
    auditar(req, 'webhook-prueba', { destino, ok: true });
    res.json({ ok: true, url: cfg.url, ms: Date.now() - inicio, firmado: !!cfg.secret });
  } catch (e) {
    auditar(req, 'webhook-prueba', { destino, ok: false });
    res.status(502).json({ ok: false, url: cfg.url, ms: Date.now() - inicio, error: (e as Error).message });
  }
});

/**
 * GET /mantenimiento/webhook/domicilio/estado
 * Cuántos avisos están esperando, cuántos fallaron y cuántos pedidos siguen sin cotizar.
 * Sin esto, un webhook mal configurado se nota cuando alguien pregunta por qué ningún
 * pedido tiene precio de domicilio — o sea, tarde.
 */
router.get('/webhook/domicilio/estado', async (_req, res) => {
  const q = webhooksQueue();
  const cola = q
    ? await q.getJobCounts()
    : { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };

  const [sinCotizar, sinGeo] = await Promise.all([
    prisma.pedido.count({
      where: { requiere_domicilio: true, costoDomicilio: null, archivedAt: null,
               cliente: { latitud: { not: null } } },
    }),
    // Éstos NO se encolan: sin coordenadas no hay nada que cotizar. Se arreglan
    // geolocalizando al cliente, no tocando el webhook.
    prisma.pedido.count({
      where: { requiere_domicilio: true, costoDomicilio: null, archivedAt: null,
               OR: [{ cliente: { latitud: null } }, { clienteId: null }] },
    }),
  ]);

  const cfg = await getConfig('domicilio');
  res.json({
    configurado: !!cfg.url && !!cfg.secret,
    activo: cfg.activo,
    cola,
    sinCotizar,
    sinGeolocalizar: sinGeo,
    // Cuánto tardan en salir de verdad, medido: desde que se encolan hasta que salen.
    latencia: await resumenLatencias(),
  });
});

/**
 * POST /mantenimiento/webhook/domicilio/reencolar
 * Vuelve a mandar todo lo que sigue sin cotizar. Para el día que la APK estuvo caída:
 * los avisos de entonces ya se dieron por perdidos y nadie los va a reintentar solo.
 */
router.post('/webhook/domicilio/reencolar', async (req, res) => {
  // Primero se barren los completados. Bull no vuelve a admitir un jobId que ya existe
  // aunque esté terminado, así que sin esto el botón contestaría "681 encolados" y no
  // habría encolado ninguno. (Los que se encolen a partir de ahora se borran solos al
  // completarse; esto limpia los que quedaron del historial viejo.)
  const q = webhooksQueue();
  if (q) {
    try {
      await q.clean(0, 'completed');
      await q.clean(0, 'failed');
    } catch (e) {
      console.error('[mantenimiento] no se pudo limpiar la cola de webhooks:', (e as Error).message);
    }
  }
  const n = await encolarPendientesDeDomicilio({ limite: Number(req.body?.limite) || 1000 });
  auditar(req, 'webhook-reencolar', { destino: 'domicilio', encolados: n });
  res.json({ ok: true, encolados: n });
});

// Mismo criterio de código que el import del CSV (nombre.primer_apellido, sin tildes
// ni caracteres de control). Si cambia allí, cambia aquí.
const sinTildes = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

function sellerCode(name: string): string {
  const parts = sinTildes(String(name).trim()).split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return `${parts[0]}.${parts[parts.length - 2]}`.toLowerCase();
  if (parts.length === 2) return `${parts[0]}.${parts[1]}`.toLowerCase();
  return sinTildes(String(name)).toLowerCase();
}

/**
 * GET /mantenimiento/estado
 * Resumen para pintar el panel: totales y cosas que conviene arreglar.
 */
router.get('/estado', async (_req, res) => {
  try {
    const [pedidos, clientes, vendedores, conGeo] = await Promise.all([
      prisma.pedido.count(),
      prisma.cliente.count(),
      prisma.vendedor.count(),
      prisma.cliente.count({ where: { latitud: { not: null } } }),
    ]);

    // Duplicados por código (mismo código, dos vendedores) y códigos "sucios".
    const vs = await prisma.vendedor.findMany({ select: { id: true, nombre: true, codigo: true } });
    const porCodigoNuevo = new Map<string, { nombre: string; codigo: string | null }[]>();
    let codigosSucios = 0;
    for (const v of vs) {
      if (v.codigo && /[^\x20-\x7e]/.test(v.codigo)) codigosSucios++;
      const nuevo = sellerCode(v.nombre);
      if (!porCodigoNuevo.has(nuevo)) porCodigoNuevo.set(nuevo, []);
      porCodigoNuevo.get(nuevo)!.push({ nombre: v.nombre, codigo: v.codigo });
    }
    const posiblesDuplicados = [...porCodigoNuevo.values()].filter((a) => a.length > 1);

    res.json({
      totales: { pedidos, clientes, vendedores, clientesConGeo: conGeo, clientesSinGeo: clientes - conGeo },
      alertas: { codigosSucios, posiblesDuplicados },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo obtener el estado.' });
  }
});

/**
 * POST /mantenimiento/recompute-codigos?dry=1
 * Recalcula el código de todos los vendedores con la regla actual. Aborta si dos
 * caerían en el mismo código (colisión real).
 */
router.post('/recompute-codigos', async (req, res) => {
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const vs = await prisma.vendedor.findMany({ select: { id: true, nombre: true, codigo: true } });
    const nuevos = vs.map((v) => ({ ...v, nuevo: sellerCode(v.nombre) }));

    const porCodigo = new Map<string, typeof nuevos>();
    for (const v of nuevos) {
      if (!porCodigo.has(v.nuevo)) porCodigo.set(v.nuevo, []);
      porCodigo.get(v.nuevo)!.push(v);
    }
    const colisiones = [...porCodigo.entries()]
      .filter(([, a]) => a.length > 1)
      .map(([code, a]) => ({ code, nombres: a.map((x) => x.nombre) }));
    if (colisiones.length) {
      return res.status(409).json({ error: 'Hay colisiones: dos vendedores caerían en el mismo código.', colisiones });
    }

    const cambios = nuevos.filter((v) => v.codigo !== v.nuevo);
    if (!dry) {
      for (const v of cambios) await prisma.vendedor.update({ where: { id: v.id }, data: { codigo: v.nuevo } });
      auditar(req, 'recompute-codigos', { cambiados: cambios.length });
    }
    res.json({
      dry,
      cambiados: cambios.length,
      yaCorrectos: vs.length - cambios.length,
      detalle: cambios.map((v) => ({ nombre: v.nombre, antes: v.codigo, ahora: v.nuevo })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo recalcular los códigos.' });
  }
});

/**
 * POST /mantenimiento/merge-vendedores   body: { fromId, intoId, dry? }
 * Fusiona dos vendedores (misma persona). Mueve los pedidos con folio nuevo y elimina
 * los duplicados exactos; si un folio coincide con OTRO cliente, aborta y lo reporta.
 */
router.post('/merge-vendedores', async (req, res) => {
  try {
    const { fromId, intoId, dry } = req.body as { fromId?: string; intoId?: string; dry?: boolean };
    if (!fromId || !intoId || fromId === intoId) {
      return res.status(400).json({ error: 'Elige dos vendedores distintos (origen y destino).' });
    }
    const from = await prisma.vendedor.findUnique({ where: { id: fromId } });
    const into = await prisma.vendedor.findUnique({ where: { id: intoId } });
    if (!from || !into) return res.status(404).json({ error: 'Vendedor no encontrado.' });

    const delOrigen = await prisma.pedido.findMany({ where: { vendedorId: from.id }, select: { id: true, folio: true, clienteId: true } });
    const delDestino = await prisma.pedido.findMany({ where: { vendedorId: into.id }, select: { folio: true, clienteId: true } });
    const destinoPorFolio = new Map(delDestino.map((p) => [p.folio, p.clienteId]));

    const aMover: string[] = [];
    const aBorrar: string[] = [];
    const conflictivos: string[] = [];
    for (const p of delOrigen) {
      if (!destinoPorFolio.has(p.folio)) aMover.push(p.id);
      else if (destinoPorFolio.get(p.folio) === p.clienteId) aBorrar.push(p.id);
      else conflictivos.push(p.folio);
    }
    if (conflictivos.length) {
      return res.status(409).json({ error: 'Hay folios repetidos con OTRO cliente. Revísalos a mano.', folios: conflictivos.slice(0, 20) });
    }

    const resumen = { origen: from.nombre, destino: into.nombre, aMover: aMover.length, aBorrar: aBorrar.length, quedaria: delDestino.length + aMover.length };
    if (dry) return res.json({ dry: true, ...resumen });

    await prisma.$transaction(async (tx) => {
      if (aBorrar.length) {
        await tx.pedidoItem.deleteMany({ where: { pedidoId: { in: aBorrar } } });
        await tx.pedido.deleteMany({ where: { id: { in: aBorrar } } });
      }
      if (aMover.length) await tx.pedido.updateMany({ where: { id: { in: aMover } }, data: { vendedorId: into.id } });
      const quedan = await tx.pedido.count({ where: { vendedorId: from.id } });
      if (quedan !== 0) throw new Error(`Aún quedan ${quedan} pedidos en el origen.`);
      await tx.vendedor.delete({ where: { id: from.id } });
    });
    auditar(req, 'merge-vendedores', resumen);
    res.json({ dry: false, ...resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo fusionar.' });
  }
});

/**
 * GET /mantenimiento/backup
 * Descarga un JSON con TODO (para respaldo / traspaso). Como export-all.mjs.
 */
router.get('/backup', async (req, res) => {
  try {
    const [sucursales, roles, usuarios, vendedores, clientes, pedidos, items] = await Promise.all([
      prisma.sucursal.findMany(),
      prisma.rol.findMany(),
      prisma.usuario.findMany(),
      prisma.vendedor.findMany(),
      prisma.cliente.findMany(),
      prisma.pedido.findMany(),
      prisma.pedidoItem.findMany(),
    ]);
    auditar(req, 'backup', { pedidos: pedidos.length, clientes: clientes.length });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="backup-pedido-${stamp}.json"`);
    res.json({ exportadoEn: new Date().toISOString(), sucursales, roles, usuarios, vendedores, clientes, pedidos, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar el backup.' });
  }
});

/**
 * POST /mantenimiento/restore   (multipart: file=<backup.json>,  ?dry=1)
 * Importa un backup de OTRO servidor local (el JSON que genera /backup) para
 * consolidar históricos. Hace UPSERT por id: fusiona, NO borra nada de lo que ya hay.
 * Los usuarios solo se CREAN si no existen (no se pisan contraseñas del destino).
 */
router.post('/restore', upload.single('file') as any, async (req, res) => {
  const archivo = (req as any).file as { path: string } | undefined;
  try {
    if (!archivo) return res.status(400).json({ error: 'Falta el archivo de backup (.json).' });
    const dry = req.query.dry === '1' || req.query.dry === 'true';

    let data: any;
    try {
      data = JSON.parse(await fs.promises.readFile(archivo.path, 'utf8'));
    } catch {
      return res.status(400).json({ error: 'El archivo no es un JSON válido.' });
    }

    const arr = (k: string) => (Array.isArray(data?.[k]) ? data[k] : []);
    const sucursales = arr('sucursales');
    const roles = arr('roles');
    const usuarios = arr('usuarios');
    const vendedores = arr('vendedores');
    const clientes = arr('clientes');
    const pedidos = arr('pedidos');
    const items = arr('items');

    const resumen = {
      sucursales: sucursales.map((s: any) => ({ nombre: s.nombre, codigo: s.codigo })),
      cuenta: { sucursales: sucursales.length, roles: roles.length, usuarios: usuarios.length, vendedores: vendedores.length, clientes: clientes.length, pedidos: pedidos.length, items: items.length },
    };
    if (dry) return res.json({ dry: true, ...resumen });

    // Miles de upserts tardan más que el timeout del proxy (60s): se procesa en SEGUNDO
    // PLANO. Respondemos 202 + jobId; el front consulta /mantenimiento/job/:jobId.
    const jobId = randomUUID();
    jobsSet(jobId, { estado: 'pendiente', tipo: 'restore' });
    res.status(202).json({ enqueued: true, jobId, dry: false, ...resumen });
    void runBg(jobId, async () => {

    // Sucursales: se resuelven por CÓDIGO (identidad de negocio), NO por id — en cada
    // servidor los ids son distintos. Se arma un mapa idBackup -> idLocal para remapear
    // TODOS los hijos (usuarios, vendedores, clientes, pedidos). Cada fila en su propio
    // try: una fila mala no aborta el import completo.
    const sucMap = new Map<string, string>();
    for (const s of sucursales) {
      try {
        const codigo = (s.codigo ? String(s.codigo).trim().toUpperCase() : '') || null;
        let local = codigo ? await prisma.sucursal.findFirst({ where: { codigo } }) : null;
        if (!local) local = await prisma.sucursal.findUnique({ where: { id: s.id } });
        if (!local) local = await prisma.sucursal.create({ data: { nombre: s.nombre, codigo } });
        else if (codigo && !local.codigo) await prisma.sucursal.update({ where: { id: local.id }, data: { codigo } });
        sucMap.set(s.id, local.id);
      } catch { /* sucursal mala: se salta */ }
    }
    const mapSuc = (id: string | null | undefined) => (id && sucMap.get(id)) || id || null;

    // Roles por NOMBRE (estándar; cada servidor los siembra con ids distintos).
    const roleMap = new Map<string, string>();
    for (const r of roles) {
      try {
        const dest = await prisma.rol.upsert({ where: { nombre: r.nombre }, update: {}, create: { nombre: r.nombre } });
        roleMap.set(r.id, dest.id);
      } catch { /* rol malo: se salta */ }
    }
    // Usuarios: solo crear si no existen (no pisar los del destino); sucursalId remapeado.
    let usuariosNuevos = 0;
    for (const u of usuarios) {
      try {
        const existe = await prisma.usuario.findFirst({ where: { OR: [{ id: u.id }, { username: u.username }] } });
        if (existe) continue;
        await prisma.usuario.create({ data: { id: u.id, username: u.username, password: u.password, rolId: u.rolId ? (roleMap.get(u.rolId) ?? null) : null, sucursalId: mapSuc(u.sucursalId), createdAt: fecha(u.createdAt) ?? undefined } });
        usuariosNuevos++;
      } catch { /* se salta */ }
    }
    // VENDEDORES por CÓDIGO (y si no, por nombre+sucursal) — NUNCA por id (los ids cambian
    // por servidor). Mapa backupVendId -> idLocal para remapear los pedidos: si se matchea
    // por id, el pedido queda con vendedor N/A (bug histórico). Reusa el existente si lo hay.
    const vendMap = new Map<string, string>();
    const prefixMap = new Map<string, string>();
    const folioPref = (code: string | null | undefined) =>
      code ? 'P' + code.split('.').filter(Boolean).map((s) => s.charAt(0)).join('').toUpperCase() : null;
    let vendOk = 0;
    for (const v of vendedores) {
      try {
        let gestorId = v.gestorId ?? null;
        if (gestorId && !(await prisma.usuario.findUnique({ where: { id: gestorId } }))) gestorId = null;
        // Sin gestor no hay sucursal: un vendedor "Sin asignar" no pertenece a
        // ninguna. Restaurar un backup no puede colarlo dentro de una sucursal.
        const sucId = gestorId ? mapSuc(v.sucursalId) : null;
        const codigoV: string | null = v.codigo ?? null;
        let local = codigoV ? await prisma.vendedor.findUnique({ where: { codigo: codigoV } }) : null;
        if (!local) local = await prisma.vendedor.findFirst({ where: { nombre: v.nombre, sucursalId: sucId } });
        if (local) {
          // reusar el existente; solo completar lo que le falte (no pisar lo bueno).
          const upd: any = {};
          if (!local.sucursalId && sucId) upd.sucursalId = sucId;
          if (!local.gestorId && gestorId) upd.gestorId = gestorId;
          if (!local.codigo && codigoV) { const clash = await prisma.vendedor.findUnique({ where: { codigo: codigoV } }); if (!clash || clash.id === local.id) upd.codigo = codigoV; }
          if (Object.keys(upd).length) await prisma.vendedor.update({ where: { id: local.id }, data: upd });
          vendMap.set(v.id, local.id);
          { const pf = folioPref(local.codigo || codigoV); if (pf) prefixMap.set(pf, local.id); }
        } else {
          let cod = codigoV;
          if (cod) { const clash = await prisma.vendedor.findUnique({ where: { codigo: cod } }); if (clash) cod = null; }
          const creado = await prisma.vendedor.create({ data: { nombre: v.nombre, codigo: cod, sucursalId: sucId, gestorId, activo: v.activo ?? true, createdAt: fecha(v.createdAt) ?? undefined } });
          vendMap.set(v.id, creado.id);
          { const pf = folioPref(creado.codigo); if (pf) prefixMap.set(pf, creado.id); }
        }
        vendOk++;
      } catch { /* se salta */ }
    }
    // CLIENTES: se resuelven por (nombre, sucursalId) — NO por id — para NO chocar con los
    // que ya existen (ej. los de Parranda). Si existe, se reusa; si no, se crea. Mapa
    // backupClienteId -> idLocal para remapear los pedidos (esto es lo que hacía perder
    // casi todos los pedidos: el cliente se saltaba y el pedido quedaba con FK rota).
    const cliMap = new Map<string, string>();
    let cliOk = 0;
    for (const c of clientes) {
      try {
        const sucId = mapSuc(c.sucursalId);
        const existente = await prisma.cliente.findFirst({ where: { nombre: c.nombre, sucursalId: sucId } });
        if (existente) { cliMap.set(c.id, existente.id); continue; }
        const cData: any = { nombre: c.nombre, sucursalId: sucId, codigo: c.codigo ?? null, zona: c.zona ?? null, direccion: c.direccion ?? null, municipio: c.municipio ?? null, tipoCliente: c.tipoCliente ?? null, estadoCompra: c.estadoCompra ?? null, latitud: c.latitud ?? null, longitud: c.longitud ?? null, geolocalizacion: c.geolocalizacion ?? null, createdAt: fecha(c.createdAt) ?? undefined };
        let creado;
        try { creado = await prisma.cliente.create({ data: cData }); }
        catch { creado = await prisma.cliente.create({ data: { ...cData, codigo: null } }); } // codigo duplicado
        cliMap.set(c.id, creado.id); cliOk++;
      } catch { /* se salta */ }
    }
    // PEDIDOS: se matchean por su clave de negocio (sucursalId, folio, vendedorId) para NO
    // chocar con el único; clienteId/vendedorId remapeados a los ids locales. pedMap -> items.
    const pedMap = new Map<string, { id: string; nuevo: boolean }>();
    let pedOk = 0;
    for (const p of pedidos) {
      try {
        const sucId = mapSuc(p.sucursalId);
        const clienteId = p.clienteId ? (cliMap.get(p.clienteId) ?? null) : null;
        let vendedorId = p.vendedorId ? (vendMap.get(p.vendedorId) ?? null) : null;
        if (!vendedorId && p.folio) vendedorId = prefixMap.get(String(p.folio).substring(0, 3)) ?? null;
        const base = { sucursalId: sucId, vendedorId, clienteId, direccion: p.direccion ?? null, encargado: p.encargado ?? null, telefono: p.telefono ?? null, fecha: fecha(p.fecha) ?? new Date(), fecha_comprometida: fecha(p.fecha_comprometida), estado: p.estado ?? null, pedido_cobrado: p.pedido_cobrado ?? null, requiere_domicilio: p.requiere_domicilio ?? null, costoDomicilio: p.costoDomicilio ?? null };
        const existente = await prisma.pedido.findFirst({ where: { sucursalId: sucId, folio: p.folio, vendedorId } });
        if (existente) { await prisma.pedido.update({ where: { id: existente.id }, data: base }); pedMap.set(p.id, { id: existente.id, nuevo: false }); }
        else { const creado = await prisma.pedido.create({ data: { folio: p.folio, ...base, createdAt: fecha(p.createdAt) ?? undefined } }); pedMap.set(p.id, { id: creado.id, nuevo: true }); pedOk++; }
      } catch { /* se salta */ }
    }
    // ITEMS: solo de pedidos NUEVOS (los existentes ya tienen los suyos). pedidoId remapeado.
    let itemOk = 0;
    for (const it of items) {
      try {
        const ped = pedMap.get(it.pedidoId);
        if (!ped || !ped.nuevo) continue;
        await prisma.pedidoItem.create({ data: { pedidoId: ped.id, codigo: it.codigo ?? null, producto: it.producto, unidades: it.unidades, packs: it.packs ?? null, descripcion: it.descripcion ?? null } });
        itemOk++;
      } catch { /* se salta */ }
    }

    const importados = { usuariosNuevos, vendedores: vendOk, clientes: cliOk, pedidos: pedOk, items: itemOk };
    auditar(req, 'restore', { ...resumen.cuenta, ...importados });
    return importados;
    });
  } catch (err) {
    console.error('Error en restore:', err);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo importar el backup.' });
  } finally {
    if (archivo?.path) fs.promises.unlink(archivo.path).catch(() => {});
  }
});

// -----------------------------------------------------------------------------
// Importar una sucursal desde su SQLite VIEJO (dev.db del PEDIDO mono-sucursal).
// Consolida en la base central SIN pisar las otras sucursales:
//  - Sucursal: se resuelve por CÓDIGO (identidad de negocio), no por id (evita choques
//    si varias máquinas se clonaron de la misma plantilla). Todo lo demás se etiqueta
//    con el id de ESA sucursal.
//  - Roles: por NOMBRE (set único global); se remapea usuario.rolId.
//  - Usuarios: el 'admin' semilla se SALTA (= el Super Admin de la nube). Cualquier otro
//    username que ya exista se importa con sufijo .codigo (ej. ernesto -> ernesto.stg),
//    así NUNCA da error ni se pierde a la persona.
//  - Vendedores: SIN gestor asignado (gestorId null) -> los pedidos quedan sin asignar.
//  - Clientes / Pedidos / Items: por sucursal; costoDomicilio se recalcula luego.
// Cada fila va en su propio try: una fila mala no aborta la importación completa.
// -----------------------------------------------------------------------------
router.post('/import-sqlite', upload.single('file') as any, async (req, res) => {
  const archivo = (req as any).file as { path: string } | undefined;
  let db: any;
  try {
    if (!archivo) return res.status(400).json({ error: 'Falta el archivo .db (SQLite del PEDIDO viejo).' });
    const codigo = String(req.body?.codigo || '').trim().toUpperCase();
    const nombreArg = String(req.body?.nombre || '').trim();
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    if (!codigo) return res.status(400).json({ error: 'Falta el código de la sucursal (ej. STG).' });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    try {
      db = new Database(archivo.path, { readonly: true, fileMustExist: true });
    } catch {
      return res.status(400).json({ error: 'El archivo no es una base SQLite válida.' });
    }
    const tabla = (t: string): any[] => {
      try { return db.prepare(`SELECT * FROM "${t}"`).all(); } catch { return []; }
    };

    const sucursalesSrc = tabla('Sucursal');
    const rolesSrc = tabla('Roles').length ? tabla('Roles') : tabla('Role');
    const usuariosSrc = tabla('User');
    const vendedoresSrc = tabla('Seller');
    const clientesSrc = tabla('Client');
    const pedidosSrc = tabla('Order');
    const itemsSrc = tabla('OrderItem');

    const cuenta = {
      usuarios: usuariosSrc.length, vendedores: vendedoresSrc.length,
      clientes: clientesSrc.length, pedidos: pedidosSrc.length, items: itemsSrc.length,
    };
    // Ya leímos todo a arrays: cerramos el .db y borramos el archivo (el proceso ya no
    // los necesita), así el trabajo en 2do plano no depende de ellos.
    try { db.close(); } catch { /* noop */ }
    db = null;
    if (archivo?.path) fs.promises.unlink(archivo.path).catch(() => {});
    if (dry) return res.json({ dry: true, codigo, cuenta });

    // Miles de filas -> SEGUNDO PLANO (evita el timeout del proxy). 202 + jobId; el front
    // consulta /mantenimiento/job/:jobId.
    const jobId = randomUUID();
    jobsSet(jobId, { estado: 'pendiente', tipo: 'import-sqlite' });
    res.status(202).json({ enqueued: true, jobId, codigo, cuenta });
    void runBg(jobId, async () => {

    // 1) Sucursal por CÓDIGO.
    let suc = await prisma.sucursal.findFirst({ where: { codigo } });
    if (!suc) {
      const nombre = nombreArg || sucursalesSrc[0]?.nombre || codigo;
      suc = await prisma.sucursal.create({ data: { nombre, codigo } });
    }
    const sucursalId = suc.id;

    // 2) Roles por nombre -> mapa idOrigen -> idDestino.
    const roleMap = new Map<string, string>();
    for (const r of rolesSrc) {
      const nombre = r.rol ?? r.nombre ?? r.name;
      if (!nombre) continue;
      const dest = await prisma.rol.upsert({ where: { nombre }, update: {}, create: { nombre } });
      roleMap.set(String(r.id), dest.id);
    }

    // 3) Usuarios: salta 'admin'; los repetidos entran con sufijo .codigo.
    let usuariosNuevos = 0;
    const renombrados: string[] = [];
    for (const u of usuariosSrc) {
      try {
        const uname = String(u.username || '').trim();
        if (!uname || uname.toLowerCase() === 'admin') continue;
        let finalName = uname;
        if (await prisma.usuario.findUnique({ where: { username: finalName } })) {
          finalName = `${uname}.${codigo.toLowerCase()}`;
          if (await prisma.usuario.findUnique({ where: { username: finalName } })) continue; // ya importado antes
          renombrados.push(`${uname} → ${finalName}`);
        }
        await prisma.usuario.create({
          data: {
            username: finalName,
            password: u.password,
            rolId: u.roleId ? (roleMap.get(String(u.roleId)) ?? null) : null,
            sucursalId,
            createdAt: fecha(u.createdAt) ?? undefined,
          },
        });
        usuariosNuevos++;
      } catch { /* fila mala: se salta */ }
    }

    // 4) Vendedores por CÓDIGO (o nombre+sucursal), NUNCA por id (cambia por servidor).
    //    vendMap: backupVendId -> idLocal para remapear pedidos. prefixMap: prefijo de folio
    //    (P+iniciales del código, ej. deyanira.zaldivar -> PDZ) -> idLocal, como RESPALDO
    //    para sacar el vendedor DESDE EL PEDIDO si no matchea por id (evita el N/A).
    const vendMap = new Map<string, string>();
    const prefixMap = new Map<string, string>();
    const folioPref = (code: string | null | undefined) =>
      code ? 'P' + code.split('.').filter(Boolean).map((s) => s.charAt(0)).join('').toUpperCase() : null;
    let vendOk = 0;
    for (const v of vendedoresSrc) {
      try {
        const codigoV: string | null = v.code ?? null;
        let local = codigoV ? await prisma.vendedor.findUnique({ where: { codigo: codigoV } }) : null;
        if (!local) local = await prisma.vendedor.findFirst({ where: { nombre: v.name, sucursalId } });
        let localId: string;
        if (local) {
          const upd: any = {};
          // Solo se le pone sucursal si YA tiene gestor. Sin gestor va "Sin
          // asignar", sin sucursal: importar la base vieja de una sucursal no
          // puede fichar ahi a un vendedor que nadie lleva.
          if (!local.sucursalId && local.gestorId && sucursalId) upd.sucursalId = sucursalId;
          if (!local.codigo && codigoV) { const clash = await prisma.vendedor.findUnique({ where: { codigo: codigoV } }); if (!clash || clash.id === local.id) upd.codigo = codigoV; }
          if (Object.keys(upd).length) await prisma.vendedor.update({ where: { id: local.id }, data: upd });
          localId = local.id;
        } else {
          let cod = codigoV;
          if (cod) { const clash = await prisma.vendedor.findUnique({ where: { codigo: cod } }); if (clash) cod = null; }
          // Nace sin gestor => nace sin sucursal.
          const creado = await prisma.vendedor.create({ data: { nombre: v.name, codigo: cod, sucursalId: null, gestorId: null, activo: true, createdAt: fecha(v.createdAt) ?? undefined } });
          localId = creado.id;
        }
        vendMap.set(v.id, localId);
        const pf = folioPref(local?.codigo || codigoV);
        if (pf) prefixMap.set(pf, localId);
        vendOk++;
      } catch { /* se salta */ }
    }

    // 5) Clientes (por sucursal).
    // CLIENTES por (nombre, sucursalId) -> mapa (NO chocar con Parranda/existentes; esto
    // evitaba que casi todos los pedidos entraran).
    const cliMap = new Map<string, string>();
    let cliOk = 0;
    for (const c of clientesSrc) {
      try {
        const existente = await prisma.cliente.findFirst({ where: { nombre: c.nombre, sucursalId } });
        if (existente) { cliMap.set(c.id, existente.id); continue; }
        const cData: any = { nombre: c.nombre, sucursalId, codigo: c.parrandaId ?? null, zona: c.zona ?? null, createdAt: fecha(c.createdAt) ?? undefined };
        let creado;
        try { creado = await prisma.cliente.create({ data: cData }); }
        catch { creado = await prisma.cliente.create({ data: { ...cData, codigo: null } }); }
        cliMap.set(c.id, creado.id); cliOk++;
      } catch { /* se salta */ }
    }

    // 6) PEDIDOS por (sucursalId, folio, vendedorId); clienteId/vendedorId remapeados. + items.
    const pedMap = new Map<string, { id: string; nuevo: boolean }>();
    let pedOk = 0;
    for (const p of pedidosSrc) {
      try {
        const clienteId = p.clientId ? (cliMap.get(p.clientId) ?? null) : null;
        let vendedorId = p.sellerId ? (vendMap.get(p.sellerId) ?? null) : null;
        if (!vendedorId && p.folio) vendedorId = prefixMap.get(String(p.folio).substring(0, 3)) ?? null;
        const base = {
          sucursalId, vendedorId, clienteId,
          direccion: p.direccion ?? null, encargado: p.encargado ?? null, telefono: p.telefono ?? null,
          fecha: fecha(p.fecha) ?? new Date(), fecha_comprometida: fecha(p.fecha_comprometida),
          estado: p.status ?? null, pedido_cobrado: p.paymentStatus ?? null,
          requiere_domicilio: p.requiresDelivery == null ? null : Boolean(p.requiresDelivery),
          costoDomicilio: null,
        };
        const existente = await prisma.pedido.findFirst({ where: { sucursalId, folio: p.folio, vendedorId } });
        if (existente) { await prisma.pedido.update({ where: { id: existente.id }, data: base }); pedMap.set(p.id, { id: existente.id, nuevo: false }); }
        else { const creado = await prisma.pedido.create({ data: { folio: p.folio, ...base, createdAt: fecha(p.createdAt) ?? undefined } }); pedMap.set(p.id, { id: creado.id, nuevo: true }); pedOk++; }
      } catch { /* se salta */ }
    }
    let itemOk = 0;
    for (const it of itemsSrc) {
      try {
        const ped = pedMap.get(it.orderId);
        if (!ped || !ped.nuevo) continue;
        await prisma.pedidoItem.create({ data: { pedidoId: ped.id, codigo: it.code ?? null, producto: it.producto, unidades: it.unidades, packs: it.packs ?? null, descripcion: it.descripcion ?? null } });
        itemOk++;
      } catch { /* se salta */ }
    }

    const resultado = {
      sucursal: { id: sucursalId, codigo, nombre: suc.nombre },
      importados: { usuarios: usuariosNuevos, vendedores: vendOk, clientes: cliOk, pedidos: pedOk, items: itemOk },
      renombrados,
    };
    auditar(req, 'import-sqlite', { codigo, ...resultado.importados, renombrados: renombrados.length });
    return resultado;
    });
  } catch (err) {
    console.error('Error en import-sqlite:', err);
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo importar la base SQLite.' });
  } finally {
    if (db) { try { db.close(); } catch { /* noop */ } }
    if (archivo?.path) fs.promises.unlink(archivo.path).catch(() => {});
  }
});

export default router;
