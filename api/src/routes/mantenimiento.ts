import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';

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

    // Orden respetando las claves foráneas. Todo por upsert (id preservado).
    for (const s of sucursales) {
      await prisma.sucursal.upsert({ where: { id: s.id }, update: { nombre: s.nombre, codigo: s.codigo ?? undefined }, create: { id: s.id, nombre: s.nombre, codigo: s.codigo ?? null, createdAt: fecha(s.createdAt) ?? undefined } });
    }
    // Roles: se identifican por NOMBRE (son estándar y cada servidor los siembra con
    // ids distintos). Se arma un mapa idOrigen -> idDestino para remapear los usuarios.
    const roleMap = new Map<string, string>();
    for (const r of roles) {
      const dest = await prisma.rol.upsert({ where: { nombre: r.nombre }, update: {}, create: { nombre: r.nombre } });
      roleMap.set(r.id, dest.id);
    }
    // Usuarios: solo crear si no existen (no pisar los del destino); rolId remapeado.
    let usuariosNuevos = 0;
    for (const u of usuarios) {
      const existe = await prisma.usuario.findFirst({ where: { OR: [{ id: u.id }, { username: u.username }] } });
      if (existe) continue;
      await prisma.usuario.create({ data: { id: u.id, username: u.username, password: u.password, rolId: u.rolId ? (roleMap.get(u.rolId) ?? null) : null, sucursalId: u.sucursalId, createdAt: fecha(u.createdAt) ?? undefined } });
      usuariosNuevos++;
    }
    for (const v of vendedores) {
      // gestorId solo si ese usuario existe ya en el destino (evita romper la FK).
      let gestorId = v.gestorId ?? null;
      if (gestorId && !(await prisma.usuario.findUnique({ where: { id: gestorId } }))) gestorId = null;
      await prisma.vendedor.upsert({ where: { id: v.id }, update: { nombre: v.nombre, codigo: v.codigo ?? undefined, sucursalId: v.sucursalId, gestorId, activo: v.activo ?? true }, create: { id: v.id, nombre: v.nombre, codigo: v.codigo ?? null, sucursalId: v.sucursalId, gestorId, activo: v.activo ?? true, createdAt: fecha(v.createdAt) ?? undefined } });
    }
    for (const c of clientes) {
      const base = { nombre: c.nombre, codigo: c.codigo ?? null, zona: c.zona ?? null, sucursalId: c.sucursalId, direccion: c.direccion ?? null, municipio: c.municipio ?? null, tipoCliente: c.tipoCliente ?? null, estadoCompra: c.estadoCompra ?? null, latitud: c.latitud ?? null, longitud: c.longitud ?? null, geolocalizacion: c.geolocalizacion ?? null };
      await prisma.cliente.upsert({ where: { id: c.id }, update: base, create: { id: c.id, ...base, createdAt: fecha(c.createdAt) ?? undefined } });
    }
    for (const p of pedidos) {
      const base = { folio: p.folio, sucursalId: p.sucursalId, vendedorId: p.vendedorId ?? null, clienteId: p.clienteId ?? null, direccion: p.direccion ?? null, encargado: p.encargado ?? null, telefono: p.telefono ?? null, fecha: fecha(p.fecha) ?? new Date(), fecha_comprometida: fecha(p.fecha_comprometida), estado: p.estado ?? null, pedido_cobrado: p.pedido_cobrado ?? null, requiere_domicilio: p.requiere_domicilio ?? null, costoDomicilio: p.costoDomicilio ?? null };
      await prisma.pedido.upsert({ where: { id: p.id }, update: base, create: { id: p.id, ...base, createdAt: fecha(p.createdAt) ?? undefined } });
    }
    for (const it of items) {
      const base = { pedidoId: it.pedidoId, codigo: it.codigo ?? null, producto: it.producto, unidades: it.unidades, packs: it.packs ?? null, descripcion: it.descripcion ?? null };
      await prisma.pedidoItem.upsert({ where: { id: it.id }, update: base, create: { id: it.id, ...base } });
    }

    auditar(req, 'restore', { ...resumen.cuenta, usuariosNuevos });
    res.json({ dry: false, ...resumen, usuariosNuevos });
  } catch (err) {
    console.error('Error en restore:', err);
    res.status(500).json({ error: 'No se pudo importar el backup.' });
  } finally {
    if (archivo?.path) fs.promises.unlink(archivo.path).catch(() => {});
  }
});

export default router;
