import { Router } from 'express';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';

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

export default router;
