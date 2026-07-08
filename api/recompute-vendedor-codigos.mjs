// Recalcula el `codigo` de los vendedores existentes con la regla nueva
// (nombre.primer_apellido), la misma que usa el import del CSV.
//
// Hace falta UNA vez tras actualizar generateSellerCode: los vendedores viejos
// tienen el código con las 2 primeras palabras (ej. "glenda.melisa") y el próximo
// CSV generaría "glenda.blanco" -> no lo encontraría y crearía un duplicado.
//
// Aborta si dos vendedores caen en el mismo código (colisión real: revísalos a mano).
//
// Uso:
//   node recompute-vendedor-codigos.mjs --dry     # solo muestra qué cambiaría
//   node recompute-vendedor-codigos.mjs           # aplica

import 'dotenv/config';
import { createPrismaClient } from './prisma-node-client.mjs';

const prisma = createPrismaClient();
const DRY = process.argv.includes('--dry');

// Misma regla que src/dto/orderRecord.dto.ts -> generateSellerCode.
// OJO: si estas dos divergen, el import dejaría de encontrar a los vendedores y
// crearía duplicados. Cualquier cambio va en los DOS sitios.
const sinTildes = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

function sellerCode(name) {
  const parts = sinTildes(String(name).trim()).split(/\s+/);
  if (parts.length >= 3) return `${parts[0]}.${parts[parts.length - 2]}`.toLowerCase();
  if (parts.length === 2) return `${parts[0]}.${parts[1]}`.toLowerCase();
  return sinTildes(String(name)).toLowerCase();
}

async function main() {
  const vendedores = await prisma.vendedor.findMany({ select: { id: true, nombre: true, codigo: true } });
  console.log(`Vendedores: ${vendedores.length}${DRY ? '  [DRY-RUN]' : ''}\n`);

  const nuevos = vendedores.map((v) => ({ ...v, nuevo: sellerCode(v.nombre) }));

  // Colisiones: dos vendedores distintos con el mismo código nuevo.
  const porCodigo = new Map();
  for (const v of nuevos) {
    if (!porCodigo.has(v.nuevo)) porCodigo.set(v.nuevo, []);
    porCodigo.get(v.nuevo).push(v);
  }
  const colisiones = [...porCodigo.entries()].filter(([, vs]) => vs.length > 1);
  if (colisiones.length) {
    console.error('COLISIONES (dos vendedores comparten código nuevo). No se cambió nada:');
    for (const [code, vs] of colisiones) console.error(`  ${code}: ${vs.map((v) => v.nombre).join(' | ')}`);
    process.exitCode = 1;
    return;
  }

  let cambiados = 0;
  for (const v of nuevos) {
    if (v.codigo === v.nuevo) continue;
    console.log(`  ${v.nombre}\n    ${v.codigo ?? '(sin código)'}  ->  ${v.nuevo}`);
    if (!DRY) await prisma.vendedor.update({ where: { id: v.id }, data: { codigo: v.nuevo } });
    cambiados++;
  }

  console.log(`\n===== ${cambiados} códigos ${DRY ? 'cambiarían' : 'actualizados'} · ${vendedores.length - cambiados} ya correctos =====`);
}

main()
  .catch((e) => { console.error('FALLÓ:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
