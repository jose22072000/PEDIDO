// Copia TODOS los datos de un PEDIDO viejo en SQLite a la base PostgreSQL nueva.
//
// Lee el dev.db en SOLO LECTURA (no lo toca) y escribe en Postgres preservando los
// ids, de modo que las relaciones se mantienen. Las columnas nuevas se rellenan:
//   Sucursal.codigo   -> el que se pase por --codigo (ej. CAM)
//   Seller.sucursalId -> la sucursal de la instalación   · gestorId null · activo true
//   Client.sucursalId -> idem  (la geolocalización se importa aparte)
//   Order.sucursalId  -> idem  · costoDomicilio null
//
// Es idempotente: usa upsert por id, así que se puede repetir sin duplicar.
//
// Uso:
//   node copy-sqlite-to-postgres.mjs --db <ruta/dev.db> --codigo CAM [--dry]
//
// Requiere DATABASE_PROVIDER=postgres y DATABASE_URL apuntando al Postgres destino.

import 'dotenv/config';
import { createRequire } from 'node:module';
import { createPrismaClient } from './prisma-node-client.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const prisma = createPrismaClient();
const DRY = process.argv.includes('--dry');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

// SQLite guarda DateTime como entero (ms) o texto ISO según cómo se escribió.
const fecha = (v) => (v == null ? null : v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v)));
const bool = (v) => (v == null ? null : Boolean(v));

async function main() {
  const dbPath = arg('db');
  const codigo = arg('codigo');
  if (!dbPath) throw new Error('Falta --db <ruta al dev.db de origen>');
  if (!codigo) throw new Error('Falta --codigo <código de la sucursal, ej. CAM>');
  if (!/postgres/i.test(process.env.DATABASE_URL || '')) {
    throw new Error('DATABASE_URL no apunta a PostgreSQL. Aborto para no escribir en el sitio equivocado.');
  }

  const db = new Database(dbPath, { readonly: true });
  const all = (t) => db.prepare(`SELECT * FROM "${t}"`).all();

  const sucursales = all('Sucursal');
  const roles = all('Roles');
  const usuarios = all('User');
  const vendedores = all('Seller');
  const clientes = all('Client');
  const pedidos = all('Order');
  const items = all('OrderItem');

  console.log(`Origen: ${dbPath}${DRY ? '  [DRY-RUN]' : ''}`);
  console.log(`  sucursales ${sucursales.length} · roles ${roles.length} · usuarios ${usuarios.length}`);
  console.log(`  vendedores ${vendedores.length} · clientes ${clientes.length} · pedidos ${pedidos.length} · items ${items.length}\n`);

  if (sucursales.length !== 1) {
    console.log(`OJO: hay ${sucursales.length} sucursales; el código '${codigo}' se aplicará a la primera.`);
  }
  const sucursalId = sucursales[0]?.id ?? null;
  if (!sucursalId) throw new Error('El origen no tiene ninguna Sucursal.');

  if (DRY) { console.log('[DRY] no se escribió nada.'); db.close(); return; }

  // El orden respeta las claves foráneas.
  for (const s of sucursales) {
    await prisma.sucursal.upsert({
      where: { id: s.id },
      update: { nombre: s.nombre, codigo: s.id === sucursalId ? codigo : undefined },
      create: { id: s.id, nombre: s.nombre, codigo: s.id === sucursalId ? codigo : null, createdAt: fecha(s.createdAt) },
    });
  }
  for (const r of roles) {
    await prisma.rol.upsert({
      where: { id: r.id },
      update: { nombre: r.rol },
      create: { id: r.id, nombre: r.rol, createdAt: fecha(r.createdAt) },
    });
  }
  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { id: u.id },
      update: { username: u.username, password: u.password, rolId: u.roleId, sucursalId: u.sucursalId },
      create: { id: u.id, username: u.username, password: u.password, rolId: u.roleId, sucursalId: u.sucursalId, createdAt: fecha(u.createdAt) },
    });
  }
  for (const v of vendedores) {
    await prisma.vendedor.upsert({
      where: { id: v.id },
      update: { nombre: v.name, codigo: v.code, sucursalId },
      create: { id: v.id, nombre: v.name, codigo: v.code, sucursalId, gestorId: null, activo: true, createdAt: fecha(v.createdAt) },
    });
  }
  for (const c of clientes) {
    await prisma.cliente.upsert({
      where: { id: c.id },
      update: { nombre: c.nombre, codigo: c.parrandaId, zona: c.zona, sucursalId },
      create: { id: c.id, nombre: c.nombre, codigo: c.parrandaId, zona: c.zona, sucursalId, createdAt: fecha(c.createdAt) },
    });
  }
  let n = 0;
  for (const p of pedidos) {
    const data = {
      folio: p.folio,
      sucursalId,
      vendedorId: p.sellerId,
      clienteId: p.clientId,
      direccion: p.direccion,
      encargado: p.encargado,
      telefono: p.telefono,
      fecha: fecha(p.fecha),
      fecha_comprometida: fecha(p.fecha_comprometida),
      estado: p.status,
      pedido_cobrado: p.paymentStatus,
      requiere_domicilio: bool(p.requiresDelivery),
    };
    await prisma.pedido.upsert({
      where: { id: p.id },
      update: data,
      create: { id: p.id, ...data, createdAt: fecha(p.createdAt) },
    });
    if (++n % 500 === 0) console.log(`  pedidos: ${n}/${pedidos.length}`);
  }
  let m = 0;
  for (const it of items) {
    const data = { pedidoId: it.orderId, codigo: it.code, producto: it.producto, unidades: it.unidades, packs: it.packs, descripcion: it.descripcion };
    await prisma.pedidoItem.upsert({ where: { id: it.id }, update: data, create: { id: it.id, ...data } });
    if (++m % 1000 === 0) console.log(`  items: ${m}/${items.length}`);
  }
  db.close();

  // Verificación: los totales deben cuadrar.
  const fin = {
    sucursales: await prisma.sucursal.count(),
    roles: await prisma.rol.count(),
    usuarios: await prisma.usuario.count(),
    vendedores: await prisma.vendedor.count(),
    clientes: await prisma.cliente.count(),
    pedidos: await prisma.pedido.count(),
    items: await prisma.pedidoItem.count(),
  };
  console.log('\n===== DESTINO (Postgres) =====');
  for (const [k, v] of Object.entries(fin)) console.log(`  ${k.padEnd(12)} ${v}`);

  const esperado = { vendedores: vendedores.length, clientes: clientes.length, pedidos: pedidos.length, items: items.length };
  const malos = Object.entries(esperado).filter(([k, v]) => fin[k] < v);
  if (malos.length) {
    console.error(`\n❌ Faltan filas: ${malos.map(([k, v]) => `${k} ${fin[k]}/${v}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\n✔ Todas las filas se copiaron.');
  }
}

main()
  .catch((e) => { console.error('FALLÓ:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
