// Fusiona dos vendedores que son la MISMA persona (típico: una importación entró con
// el encoding roto y creó un vendedor fantasma —"PADRÃN" en vez de "PADRÓN"— que se
// quedó con parte de los pedidos).
//
// Mueve todos los pedidos del vendedor ORIGEN al DESTINO y borra el origen.
// No se pierde ningún pedido: solo cambian de dueño.
//
// Uso:
//   node merge-vendedores.mjs --from <codigo|id> --into <codigo|id> [--dry]
//
//   --dry   muestra qué haría, sin escribir nada.
//
// Ejemplo (el caso del encoding roto):
//   node merge-vendedores.mjs --from alexander.padran --into alexander.padron --dry

import 'dotenv/config';
import { createPrismaClient } from './prisma-node-client.mjs';

const prisma = createPrismaClient();
const DRY = process.argv.includes('--dry');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

// Acepta el código o el id del vendedor.
async function findVendedor(ref) {
  return (
    (await prisma.vendedor.findUnique({ where: { codigo: ref } })) ??
    (await prisma.vendedor.findUnique({ where: { id: ref } }))
  );
}

async function main() {
  const fromRef = arg('from');
  const intoRef = arg('into');
  if (!fromRef || !intoRef) {
    throw new Error('Faltan --from y --into (código o id del vendedor).');
  }
  if (fromRef === intoRef) throw new Error('--from y --into son el mismo vendedor.');

  const from = await findVendedor(fromRef);
  const into = await findVendedor(intoRef);
  if (!from) throw new Error(`No encontré el vendedor origen '${fromRef}'.`);
  if (!into) throw new Error(`No encontré el vendedor destino '${intoRef}'.`);
  if (from.id === into.id) throw new Error('--from y --into resuelven al mismo vendedor.');

  const pedidosFrom = await prisma.pedido.count({ where: { vendedorId: from.id } });
  const pedidosInto = await prisma.pedido.count({ where: { vendedorId: into.id } });

  console.log(`ORIGEN   ${from.codigo ?? from.id}  "${from.nombre}"  -> ${pedidosFrom} pedidos`);
  console.log(`DESTINO  ${into.codigo ?? into.id}  "${into.nombre}"  -> ${pedidosInto} pedidos`);
  console.log(`\nSe moverán ${pedidosFrom} pedidos y se borrará el vendedor origen.`);
  console.log(`Total tras la fusión: ${pedidosFrom + pedidosInto} pedidos.${DRY ? '  [DRY-RUN]' : ''}\n`);

  if (DRY) { console.log('[DRY] no se escribió nada.'); return; }

  const movidos = await prisma.$transaction(async (tx) => {
    const r = await tx.pedido.updateMany({
      where: { vendedorId: from.id },
      data: { vendedorId: into.id },
    });
    const quedan = await tx.pedido.count({ where: { vendedorId: from.id } });
    if (quedan !== 0) throw new Error(`Aún quedan ${quedan} pedidos en el origen: se aborta.`);
    await tx.vendedor.delete({ where: { id: from.id } });
    return r.count;
  });

  const final = await prisma.pedido.count({ where: { vendedorId: into.id } });
  console.log(`✔ Movidos ${movidos} pedidos. Vendedor origen eliminado.`);
  console.log(`✔ '${into.nombre}' queda con ${final} pedidos (esperado ${pedidosFrom + pedidosInto}).`);
  if (final !== pedidosFrom + pedidosInto) {
    console.error('⚠ El total no cuadra: revísalo.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('FALLÓ:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
