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

  const delOrigen = await prisma.pedido.findMany({
    where: { vendedorId: from.id },
    select: { id: true, folio: true, clienteId: true },
  });
  const delDestino = await prisma.pedido.findMany({
    where: { vendedorId: into.id },
    select: { folio: true, clienteId: true },
  });

  // Pedido es único por (sucursalId, folio, vendedorId): si el destino ya tiene ese
  // folio, mover el del origen violaría la restricción. Eso pasa cuando el MISMO CSV
  // se importó dos veces (una con el encoding roto): son el mismo pedido duplicado.
  const destinoPorFolio = new Map(delDestino.map((p) => [p.folio, p.clienteId]));

  const aMover = [];
  const aBorrar = [];
  const conflictivos = [];
  for (const p of delOrigen) {
    if (!destinoPorFolio.has(p.folio)) aMover.push(p);
    else if (destinoPorFolio.get(p.folio) === p.clienteId) aBorrar.push(p); // duplicado exacto
    else conflictivos.push(p); // mismo folio, OTRO cliente: no se puede decidir solo
  }

  console.log(`ORIGEN   ${from.codigo ?? from.id}  "${from.nombre}"  -> ${delOrigen.length} pedidos`);
  console.log(`DESTINO  ${into.codigo ?? into.id}  "${into.nombre}"  -> ${delDestino.length} pedidos\n`);
  console.log(`  a MOVER  (folios que el destino no tiene) : ${aMover.length}`);
  console.log(`  a BORRAR (duplicado exacto: mismo folio y cliente): ${aBorrar.length}`);
  if (conflictivos.length) {
    console.error(`\n❌ ${conflictivos.length} pedidos tienen el mismo folio que el destino pero OTRO cliente.`);
    conflictivos.slice(0, 10).forEach((p) => console.error(`   folio ${p.folio}`));
    console.error('   No se puede decidir automáticamente. Revísalos a mano. No se cambió nada.');
    process.exitCode = 1;
    return;
  }

  const esperado = delDestino.length + aMover.length;
  console.log(`\n'${into.nombre}' quedaría con ${esperado} pedidos.${DRY ? '  [DRY-RUN]' : ''}\n`);

  if (DRY) { console.log('[DRY] no se escribió nada.'); return; }

  await prisma.$transaction(async (tx) => {
    // Los duplicados se eliminan (con sus items) porque ya existen en el destino.
    if (aBorrar.length) {
      const ids = aBorrar.map((p) => p.id);
      await tx.pedidoItem.deleteMany({ where: { pedidoId: { in: ids } } });
      await tx.pedido.deleteMany({ where: { id: { in: ids } } });
    }
    if (aMover.length) {
      await tx.pedido.updateMany({
        where: { id: { in: aMover.map((p) => p.id) } },
        data: { vendedorId: into.id },
      });
    }
    const quedan = await tx.pedido.count({ where: { vendedorId: from.id } });
    if (quedan !== 0) throw new Error(`Aún quedan ${quedan} pedidos en el origen: se aborta.`);
    await tx.vendedor.delete({ where: { id: from.id } });
  });

  const final = await prisma.pedido.count({ where: { vendedorId: into.id } });
  console.log(`✔ Movidos ${aMover.length} · eliminados ${aBorrar.length} duplicados. Vendedor origen borrado.`);
  console.log(`✔ '${into.nombre}' queda con ${final} pedidos (esperado ${esperado}).`);
  if (final !== esperado) {
    console.error('⚠ El total no cuadra: revísalo.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('FALLÓ:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
