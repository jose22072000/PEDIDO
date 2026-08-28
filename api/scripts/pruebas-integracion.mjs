/**
 * `/integration/orders` contra una base de verdad: lo que delivery va a recibir.
 *
 * Las pruebas de `tests/` comprueban el cruce de nombres sin base. Esto comprueba lo
 * otro, que es lo que se rompió: que el peso llegue al payload, que llegue con la unidad
 * que dice, y que los filtros dejen fuera lo que tienen que dejar fuera.
 *
 * Uso (con la API ya levantada contra la MISMA base):
 *   DATABASE_URL=postgresql://... BASE=http://localhost:8499 \
 *   SERVICE_API_KEY=... node --test --import ./tests/registrar.mjs scripts/pruebas-integracion.mjs
 *
 * La API se levanta aparte a propósito. Arrancarla desde aquí obligaba a matarla al
 * terminar, y matar a `npx` deja vivo al hijo: el proceso de pruebas se quedaba colgado
 * esperando a un servidor que ya nadie iba a cerrar.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// El cliente de la aplicación, no uno nuevo: PEDIDO usa adaptadores de driver y elige
// el suyo según DATABASE_URL. Un `new PrismaClient()` a secas ni siquiera arranca.
import prisma from '../src/prismaClient.ts'

const BASE = process.env.BASE || 'http://localhost:8499'
const KEY = process.env.SERVICE_API_KEY

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')
if (!KEY) throw new Error('Falta SERVICE_API_KEY: la misma con la que arrancó la API.')

// ------------------------------------------------------------------ siembra

const DIA = 86400000
const hoy = new Date()

hoy.setHours(12, 0, 0, 0)

const diaMenos = (n) => new Date(hoy.getTime() - n * DIA)
const comoFecha = (d) => d.toISOString().slice(0, 10)

async function sembrar() {
  await prisma.pedidoItem.deleteMany()
  await prisma.pedido.deleteMany()
  await prisma.productoVinculo.deleteMany()
  await prisma.productoSucursal.deleteMany()
  await prisma.cliente.deleteMany()
  await prisma.vendedor.deleteMany()
  await prisma.sucursal.deleteMany()

  const sucursal = await prisma.sucursal.create({
    data: { codigo: 'HAB', nombre: 'La Habana' },
  })

  /**
   * El catálogo de Ventra con sus dos trampas de verdad.
   *
   *  - El producto DUPLICADO: una fila con precio y otra con peso. Quedarse con
   *    cualquiera de las dos perdía el dato de la otra.
   *  - El nombre que NO se parece: sólo cruza por el vínculo que ató una persona.
   */
  await prisma.productoSucursal.createMany({
    data: [
      { sucursalId: sucursal.id, sku: 'V-001', nombre: 'CERVEZA PARRANDA 330 ML BLISTER 6U', precio: 6.5, pesoKg: 3.2 },
      // El MISMO nombre con dos SKU, que es como Ventra manda los duplicados: una fila
      // con precio y otra con peso.
      { sucursalId: sucursal.id, sku: 'V-002', nombre: 'MALTA GUAJIRA 330 ML', precio: 12.4, pesoKg: null },
      { sucursalId: sucursal.id, sku: 'V-003', nombre: 'MALTA GUAJIRA 330 ML', precio: null, pesoKg: 8.1 },
      { sucursalId: sucursal.id, sku: 'V-004', nombre: 'ACEITE GIRASOL 1 LT BOTELLA', precio: 3.1, pesoKg: 0.95 },
    ],
  })
  await prisma.productoVinculo.create({
    data: { nombrePedido: 'ALIMENTOS ACEITE 1L', nombreVentra: 'ACEITE GIRASOL 1 LT BOTELLA' },
  })

  const conGeo = await prisma.cliente.create({
    data: { codigo: 'C1', nombre: 'Ana', latitud: 23.12, longitud: -82.38, sucursalId: sucursal.id },
  })
  const sinGeo = await prisma.cliente.create({
    data: { codigo: 'C2', nombre: 'Beto', sucursalId: sucursal.id },
  })

  const crearPedido = async (folio, opciones) => {
    const { fecha, requiere, costo, items, clienteId = conGeo.id } = opciones

    return prisma.pedido.create({
      data: {
        folio,
        fecha,
        sucursalId: sucursal.id,
        clienteId,
        requiere_domicilio: requiere,
        costoDomicilio: costo,
        items: { create: items },
      },
    })
  }

  // Con domicilio y ya cotizado: el que delivery quiere.
  await crearPedido('PAP-COTIZADO', {
    fecha: diaMenos(1), requiere: true, costo: 4.5,
    items: [
      { producto: 'BEBIDAS PARRANDA 0.33L', unidades: 24, packs: 4 },
      { producto: 'BEBIDAS MALTA GUAJIRA 0.33L', unidades: 12, packs: 2 },
      { producto: 'ALIMENTOS ACEITE 1L', unidades: 6, packs: 1 },
      { producto: 'TELEVISOR 43 PULGADAS', unidades: 1, packs: 1 },
    ],
  })
  // Con domicilio pero SIN cotizar: aún no se puede meter en una ruta.
  await crearPedido('PAP-SIN-COSTO', {
    fecha: diaMenos(1), requiere: true, costo: null,
    items: [{ producto: 'BEBIDAS PARRANDA 0.33L', unidades: 24, packs: 4 }],
  })
  // Sin domicilio: se recoge en el almacén, no se reparte.
  await crearPedido('PAP-SIN-DOMICILIO', {
    fecha: diaMenos(1), requiere: false, costo: null,
    items: [{ producto: 'BEBIDAS PARRANDA 0.33L', unidades: 24, packs: 4 }],
  })
  // Sin geolocalización: no se puede medir la distancia.
  await crearPedido('PAP-SIN-GEO', {
    fecha: diaMenos(1), requiere: true, costo: 3, clienteId: sinGeo.id,
    items: [{ producto: 'BEBIDAS PARRANDA 0.33L', unidades: 24, packs: 4 }],
  })
  // De otro día, para el filtro de fechas.
  await crearPedido('PAP-VIEJO', {
    fecha: diaMenos(9), requiere: true, costo: 2,
    items: [{ producto: 'BEBIDAS PARRANDA 0.33L', unidades: 6, packs: 1 }],
  })

  return sucursal
}

// ------------------------------------------------------------------ la API

/** Que esté en pie ANTES de sembrar: si no, se siembra para nadie. */
async function comprobarQueEstaEnPie() {
  try {
    const r = await fetch(`${BASE}/integration/orders?limit=1`, { headers: { 'x-api-key': KEY } })

    if (r.status === 401 || r.status === 403) {
      throw new Error(`La API rechaza la clave: SERVICE_API_KEY no es la misma con la que arrancó.`)
    }
    if (!r.ok) throw new Error(`La API contestó ${r.status}.`)
  } catch (e) {
    throw new Error(`No hay API en ${BASE}. Levantala contra la MISMA base y volvé a correr esto.\n${e.message}`)
  }
}

const pedir = async (query) => {
  const r = await fetch(`${BASE}/integration/orders?${query}`, { headers: { 'x-api-key': KEY } })
  return { status: r.status, json: await r.json().catch(() => null) }
}

const porFolio = (orders, folio) => orders.find((o) => o.folio === folio)
const linea = (order, contiene) => order.items.find((i) => i.producto.includes(contiene))

await comprobarQueEstaEnPie()
await sembrar()

// ------------------------------------------------------------------ pruebas

test('sin la clave de servicio no se entrega nada', async () => {
  const r = await fetch(`${BASE}/integration/orders`)

  assert.ok(r.status === 401 || r.status === 403, `contestó ${r.status}`)
})

test('cada línea lleva el peso por unidad de venta Y el de la línea entera', async () => {
  const { json } = await pedir('limit=50')
  const p = porFolio(json.orders, 'PAP-COTIZADO')
  const cerveza = linea(p, 'PARRANDA')

  assert.equal(cerveza.pesoKg, 3.2, 'el peso de UNA unidad de venta')
  assert.equal(cerveza.pesoLineaKg, 12.8, '4 packs x 3.2 kg')
})

test('el producto duplicado no pierde el peso que sí estaba', async () => {
  const { json } = await pedir('limit=50')
  const malta = linea(porFolio(json.orders, 'PAP-COTIZADO'), 'MALTA')

  // Ventra lo manda dos veces: una fila con precio y otra con peso. Quedarse con la que
  // tiene precio dejaba esta línea sin peso, y el domicilio se cobraba como si no pesara.
  assert.equal(malta.pesoKg, 8.1)
  assert.equal(malta.pesoLineaKg, 16.2)
})

test('el vínculo que ató una persona también vale para el peso', async () => {
  const { json } = await pedir('limit=50')
  const aceite = linea(porFolio(json.orders, 'PAP-COTIZADO'), 'ACEITE')

  // Éste era el fallo: el panel lo cruzaba por el vínculo y la integración no, así que
  // salía con precio en pantalla y sin peso en el payload.
  assert.equal(aceite.pesoKg, 0.95)
  assert.equal(aceite.pesoLineaKg, 0.95)
})

test('un producto que no está en el catálogo llega con el peso en null, no en cero', async () => {
  const { json } = await pedir('limit=50')
  const tele = linea(porFolio(json.orders, 'PAP-COTIZADO'), 'TELEVISOR')

  // Cero es "no pesa nada" y null es "no lo sé". Quien recibe tiene que poder
  // distinguirlos: un cero se suma y desaparece; un null se ve.
  assert.equal(tele.pesoKg, null)
  assert.equal(tele.pesoLineaKg, null)
})

test('sin geolocalización no se manda: no hay forma de medir la distancia', async () => {
  const { json } = await pedir('limit=50')

  assert.equal(porFolio(json.orders, 'PAP-SIN-GEO'), undefined)
})

test('soloDomicilio deja fuera los que se recogen en el almacén', async () => {
  const { json } = await pedir('soloDomicilio=1&limit=50')

  assert.ok(porFolio(json.orders, 'PAP-COTIZADO'))
  assert.equal(porFolio(json.orders, 'PAP-SIN-DOMICILIO'), undefined)
})

test('conCosto deja fuera los que el repartidor aún no ha cotizado', async () => {
  const { json } = await pedir('soloDomicilio=1&conCosto=1&limit=50')

  assert.ok(porFolio(json.orders, 'PAP-COTIZADO'))
  assert.equal(porFolio(json.orders, 'PAP-SIN-COSTO'), undefined, 'sin costo no se puede rutear')
  assert.equal(porFolio(json.orders, 'PAP-SIN-DOMICILIO'), undefined)
})

test('el filtro de fechas es por la fecha del pedido', async () => {
  const dia = comoFecha(diaMenos(1))
  const { json } = await pedir(`desde=${dia}&hasta=${dia}&limit=50`)

  assert.ok(porFolio(json.orders, 'PAP-COTIZADO'))
  assert.equal(porFolio(json.orders, 'PAP-VIEJO'), undefined)

  const viejo = comoFecha(diaMenos(9))
  const otro = await pedir(`desde=${viejo}&hasta=${viejo}&limit=50`)

  assert.ok(porFolio(otro.json.orders, 'PAP-VIEJO'))
})

test('el pedido llega con su fecha, que es lo que delivery guarda como orderDate', async () => {
  const { json } = await pedir('limit=50')
  const p = porFolio(json.orders, 'PAP-COTIZADO')

  assert.ok(p.fecha, 'sin `fecha` delivery no puede saber de qué día es el pedido')
  assert.equal(comoFecha(new Date(p.fecha)), comoFecha(diaMenos(1)))
})

test('y con el cliente y sus coordenadas, que es para lo que se trae', async () => {
  const { json } = await pedir('limit=50')
  const p = porFolio(json.orders, 'PAP-COTIZADO')

  assert.equal(typeof p.cliente.latitud, 'number')
  assert.equal(typeof p.cliente.longitud, 'number')
  assert.equal(p.sucursalCodigo, 'HAB')
})

test.after(async () => {
  await prisma.$disconnect()
})
