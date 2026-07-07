// Exporta COMPLETAMENTE todos los datos de esta instalación de PEDIDO a un JSON,
// para poder extraerlo y cargarlo luego en la nube (ver import-all.mjs).
//
// Incluye todas las tablas con sus ids intactos, de modo que las relaciones se
// preserven al importar. Por defecto incluye los hashes de contraseña de Usuario
// (migración completa); usa --no-secrets para omitirlos.
//
// Uso:
//   node export-all.mjs [--out ./export-pedido-<fecha>.json] [--no-secrets]

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
const NO_SECRETS = !!arg('no-secrets', false);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT = path.resolve(__dirname, arg('out', `./export-pedido-${stamp}.json`));

async function main() {
  // Orden pensado para importar respetando las FKs.
  const [sucursales, roles, usuarios, vendedores, clientes, pedidos, pedidoItems] = await Promise.all([
    prisma.sucursal.findMany(),
    prisma.rol.findMany(),
    prisma.usuario.findMany(),
    prisma.vendedor.findMany(),
    prisma.cliente.findMany(),
    prisma.pedido.findMany(),
    prisma.pedidoItem.findMany(),
  ]);

  if (NO_SECRETS) for (const u of usuarios) u.password = null;

  const dump = {
    meta: {
      app: 'PEDIDO',
      exportedAt: new Date().toISOString(),
      secretsIncluded: !NO_SECRETS,
      counts: {
        sucursales: sucursales.length,
        roles: roles.length,
        usuarios: usuarios.length,
        vendedores: vendedores.length,
        clientes: clientes.length,
        pedidos: pedidos.length,
        pedidoItems: pedidoItems.length,
      },
    },
    // El orden de las claves = orden de importación (respeta FKs).
    sucursales,
    roles,
    usuarios,
    vendedores,
    clientes,
    pedidos,
    pedidoItems,
  };

  fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
  console.log('Exportado a:', OUT);
  console.table(dump.meta.counts);
  console.log(NO_SECRETS ? '(sin contraseñas)' : '(incluye hashes de contraseña)');
}

main()
  .catch((e) => {
    console.error('FALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
