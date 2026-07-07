// Carga en ESTA base de datos un JSON generado por export-all.mjs.
// Pensado para la migración a la nube: exportas de cada PEDIDO local y cargas
// todo aquí. Hace upsert por id (idempotente: puedes correrlo varias veces).
//
// Uso:
//   node import-all.mjs --in ./export-pedido-<fecha>.json [--dry]

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from './prisma-node-client.mjs';

const prisma = createPrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const DRY = !!arg('dry', false);
const IN = arg('in');
if (!IN || IN === true) {
  console.error('ERROR: falta --in <archivo.json> (generado por export-all.mjs).');
  process.exit(1);
}

// Upsert de un arreglo de registros en un modelo, por id.
async function upsertAll(label, model, records) {
  let ok = 0;
  for (const rec of records || []) {
    const { id, ...rest } = rec;
    if (!DRY) {
      await model.upsert({ where: { id }, create: { id, ...rest }, update: rest });
    }
    ok++;
  }
  console.log(`  ${label}: ${ok}${DRY ? ' (dry-run)' : ''}`);
  return ok;
}

async function main() {
  const file = path.resolve(process.cwd(), IN);
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Importando ${file} ${DRY ? '[DRY-RUN]' : ''}`);
  console.log('Origen:', dump.meta?.app, '| exportado:', dump.meta?.exportedAt);

  // Orden que respeta las FKs.
  await upsertAll('sucursales', prisma.sucursal, dump.sucursales);
  await upsertAll('roles', prisma.rol, dump.roles);
  await upsertAll('usuarios', prisma.usuario, dump.usuarios);
  await upsertAll('vendedores', prisma.vendedor, dump.vendedores);
  await upsertAll('clientes', prisma.cliente, dump.clientes);
  await upsertAll('pedidos', prisma.pedido, dump.pedidos);
  await upsertAll('pedidoItems', prisma.pedidoItem, dump.pedidoItems);

  console.log('Listo.');
}

main()
  .catch((e) => {
    console.error('FALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
