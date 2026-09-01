/**
 * Copiar datos DE VERDAD de producción a una base local, para poder probar con ellos.
 *
 * # Por qué existe
 *
 * La base de pruebas tenía cuatro pedidos inventados. Con eso no se ve nada de lo que
 * pasa de verdad: ni un cliente con tres pedidos el mismo día, ni un vendedor sin gestor,
 * ni un pedido facturado y otro sin facturar, ni los nombres tal y como los escribe la
 * gente. Los fallos que llegaron a producción eran justo de ahí — de casos que en local
 * no existían.
 *
 * Trae pedidos por `/integration/orders`, que es de solo lectura, y los escribe en la
 * base LOCAL. No escribe nada en producción.
 *
 * Uso:
 *   ORIGEN=https://pedidos.procovar.cloud/api SERVICE_API_KEY=... \
 *   DATABASE_URL=postgresql://...local... DATABASE_PROVIDER=postgresql \
 *   node scripts/traer-datos-reales.mjs [--dias 7]
 */
import prisma from '../src/prismaClient.ts';

const ORIGEN = process.env.ORIGEN || 'https://pedidos.procovar.cloud/api';
const KEY = process.env.SERVICE_API_KEY;
const DIAS = Number(process.argv[process.argv.indexOf('--dias') + 1]) || 7;

if (!KEY) throw new Error('Falta SERVICE_API_KEY (la de producción, solo para LEER).');
if (!process.env.DATABASE_URL?.includes('localhost')) {
  // Guardarraíl: esto ESCRIBE. Apuntarlo a producción por un copiar y pegar sería
  // catastrófico, así que sencillamente no se deja.
  throw new Error('DATABASE_URL tiene que ser una base LOCAL. Esto escribe.');
}

const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function traer(desde, hasta) {
  const r = await fetch(`${ORIGEN}/integration/orders?desde=${desde}&hasta=${hasta}&limit=500`, {
    headers: { 'x-api-key': KEY },
  });

  if (!r.ok) throw new Error(`El origen contestó ${r.status}`);

  return (await r.json()).orders ?? [];
}

async function main() {
  const pedidos = [];

  for (let i = 0; i < DIAS; i++) {
    const d = dia(i);
    const lote = await traer(d, d);

    console.log(`  ${d}: ${lote.length}`);
    pedidos.push(...lote);
  }

  console.log(`\ntraídos ${pedidos.length} pedidos. Escribiendo en local…`);

  // Se vacía lo que había: es una base de pruebas, y mezclar lo inventado con lo real
  // deja resultados que no significan nada.
  await prisma.pedidoItem.deleteMany();
  await prisma.pedido.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.vendedor.deleteMany();
  await prisma.sucursal.deleteMany();

  const sucursales = new Map();
  const vendedores = new Map();
  const clientes = new Map();

  for (const p of pedidos) {
    if (p.sucursalCodigo && !sucursales.has(p.sucursalCodigo)) {
      const s = await prisma.sucursal.create({
        data: { codigo: p.sucursalCodigo, nombre: p.sucursalNombre || p.sucursalCodigo },
      });

      sucursales.set(p.sucursalCodigo, s.id);
    }

    const v = p.vendedor;

    if (v?.id && !vendedores.has(v.id)) {
      const creado = await prisma.vendedor.create({
        data: {
          nombre: v.nombre,
          codigo: v.codigo || null,
          activo: v.activo ?? true,
          sucursalId: sucursales.get(p.sucursalCodigo) ?? null,
        },
      });

      vendedores.set(v.id, creado.id);
    }

    const c = p.cliente;

    if (c?.id && !clientes.has(c.id)) {
      const creado = await prisma.cliente.create({
        data: {
          nombre: c.nombre,
          codigo: c.codigo || null,
          municipio: c.municipio || null,
          latitud: c.latitud ?? null,
          longitud: c.longitud ?? null,
          sucursalId: sucursales.get(p.sucursalCodigo) ?? null,
        },
      });

      clientes.set(c.id, creado.id);
    }

    await prisma.pedido.create({
      data: {
        folio: p.folio,
        sucursalId: sucursales.get(p.sucursalCodigo) ?? null,
        vendedorId: v?.id ? vendedores.get(v.id) : null,
        clienteId: c?.id ? clientes.get(c.id) : null,
        direccion: p.direccion ?? null,
        encargado: p.encargado ?? null,
        telefono: p.telefono ?? null,
        fecha: new Date(p.fecha),
        fecha_comprometida: p.fechaComprometida ? new Date(p.fechaComprometida) : null,
        // El estado GUARDADO, no el que calcula la pantalla: si se guardara «expirada»
        // —que es derivado— la base local diría algo que la de verdad no dice.
        estado: p.estado ?? null,
        completedAt: p.completadoEn ? new Date(p.completadoEn) : null,
        archivedAt: p.archivadoEn ? new Date(p.archivadoEn) : null,
        pedido_cobrado: p.pedidoCobrado ?? null,
        requiere_domicilio: p.requiereDomicilio ?? null,
        costoDomicilio: p.costoDomicilio ?? null,
        facturaEstado: p.facturaEstado ?? null,
        facturaNumero: p.facturaNumero ?? null,
        facturaAt: p.facturaAt ? new Date(p.facturaAt) : null,
        facturaDomicilio: p.facturaDomicilio ?? null,
        lineasFactura: p.lineasFactura ?? null,
        estadoEntrega: p.estadoEntrega ?? null,
        items: {
          create: (p.items ?? []).map((i) => ({
            producto: i.producto,
            codigo: i.codigo ?? null,
            unidades: i.unidades ?? 0,
            packs: i.packs ?? null,
            descripcion: i.descripcion ?? null,
          })),
        },
      },
    });
  }

  const cuenta = async (donde) => prisma.pedido.count({ where: donde });

  console.log(`
LISTO. En la base local:
  sucursales   ${sucursales.size}
  vendedores   ${vendedores.size}
  clientes     ${clientes.size}
  pedidos      ${await cuenta({})}
    completados  ${await cuenta({ estado: 'completada' })}
    en proceso   ${await cuenta({ estado: 'en_proceso' })}
    facturados   ${await cuenta({ facturaEstado: { in: ['igual', 'cambiado'] } })}
    con domicilio ${await cuenta({ requiere_domicilio: true })}
`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
