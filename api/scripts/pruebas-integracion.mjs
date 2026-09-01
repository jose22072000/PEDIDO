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
    data: {
      codigo: 'C1', nombre: 'Ana', municipio: 'Playa',
      latitud: 23.12, longitud: -82.38, sucursalId: sucursal.id,
    },
  })
  const sinGeo = await prisma.cliente.create({
    data: { codigo: 'C2', nombre: 'Beto', sucursalId: sucursal.id },
  })

  const vendedor = await prisma.vendedor.create({
    data: { codigo: 'V-1', nombre: 'Vendedor Uno', sucursalId: sucursal.id },
  })

  const crearPedido = async (folio, opciones) => {
    const {
      fecha, requiere, costo, items, clienteId = conGeo.id,
      estado = 'en_proceso', archivedAt = null, comprometida = null,
    } = opciones

    return prisma.pedido.create({
      data: {
        folio,
        fecha,
        sucursalId: sucursal.id,
        clienteId,
        vendedorId: vendedor.id,
        estado,
        archivedAt,
        fecha_comprometida: comprometida,
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
  // De otro día, ARCHIVADO y completado: el 92% del catálogo real está así, y era lo que
  // el espejo dejaba fuera sin que nadie lo notara.
  await crearPedido('PAP-VIEJO', {
    fecha: diaMenos(9), requiere: true, costo: 2,
    estado: 'completada', archivedAt: diaMenos(5),
    items: [{ producto: 'BEBIDAS PARRANDA 0.33L', unidades: 6, packs: 1 }],
  })
  // Y uno EXPIRADO: la fecha comprometida ya pasó y sigue sin completarse.
  await crearPedido('PAP-EXPIRADO', {
    fecha: diaMenos(4), requiere: true, costo: 1.5,
    comprometida: diaMenos(2),
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

test('el archivado y el estado viajan en el payload', async () => {
  const { json } = await pedir('limit=50')
  const viejo = porFolio(json.orders, 'PAP-VIEJO')

  assert.equal(viejo.archivado, true, 'sin esto delivery no puede distinguir un pedido vivo de uno de hace meses')
  assert.ok(viejo.archivadoEn)
  assert.equal(viejo.estado, 'completada')

  // Los archivados vienen por defecto: son la inmensa mayoría del catálogo.
  const activos = await pedir('archivado=0&limit=50')

  assert.equal(porFolio(activos.json.orders, 'PAP-VIEJO'), undefined)
  assert.ok(porFolio(activos.json.orders, 'PAP-COTIZADO'))
})

test('«expirado» se calcula aquí, no lo tiene que deducir quien recibe', async () => {
  const { json } = await pedir('limit=50')

  assert.equal(porFolio(json.orders, 'PAP-EXPIRADO').expirado, true)
  assert.equal(porFolio(json.orders, 'PAP-COTIZADO').expirado, false)
})

test('el municipio y el vendedor van en el payload, que es por donde se filtra', async () => {
  const { json } = await pedir('limit=50')
  const p = porFolio(json.orders, 'PAP-COTIZADO')

  assert.equal(p.cliente.municipio, 'Playa')
  assert.equal(p.vendedor.nombre, 'Vendedor Uno')
})

test('`since` trae sólo lo que se movió: es lo que hace barato el espejo', async () => {
  const todos = await pedir('limit=50')
  const masNuevo = todos.json.orders.reduce(
    (max, o) => (new Date(o.updatedAt) > new Date(max) ? o.updatedAt : max),
    todos.json.orders[0].updatedAt,
  )

  const nada = await pedir(`since=${encodeURIComponent(masNuevo)}&limit=50`)

  assert.equal(nada.json.orders.length, 0, 'pedir desde lo más nuevo tiene que devolver nada')

  // Se mueve uno y aparece él solo.
  const uno = await prisma.pedido.findFirst({ where: { folio: 'PAP-COTIZADO' } })

  await prisma.pedido.update({ where: { id: uno.id }, data: { encargado: 'Tocado' } })

  const cambiado = await pedir(`since=${encodeURIComponent(masNuevo)}&limit=50`)

  assert.equal(cambiado.json.orders.length, 1)
  assert.equal(cambiado.json.orders[0].folio, 'PAP-COTIZADO')
})

// ------------------------------------------------- lo que delivery ESCRIBE de vuelta

const avisar = async (facturas) => {
  const r = await fetch(`${BASE}/integration/orders/invoicing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ facturas }),
  })

  return { status: r.status, json: await r.json().catch(() => null) }
}

const traerPorFolio = (folio) => prisma.pedido.findFirst({ where: { folio } })

test('el estado de la factura entra y se ve en el pedido', async () => {
  const antes = await traerPorFolio('PAP-COTIZADO')

  const { status, json } = await avisar([
    { pedidoId: antes.id, estado: 'cambiado', numero: 'F-1001' },
  ])

  assert.equal(status, 200)
  assert.equal(json.aplicadas.length, 1)

  const despues = await traerPorFolio('PAP-COTIZADO')

  assert.equal(despues.facturaEstado, 'cambiado')
  assert.equal(despues.facturaNumero, 'F-1001')
  assert.ok(despues.facturaAt, 'sin la hora no se distingue «no facturado» de «nadie lo ha mirado»')
})

test('repetir el mismo aviso NO mueve el pedido', async () => {
  /**
   * `updatedAt` es la marca de agua con la que sincronizan las tablets de los vendedores.
   * Si reescribir el mismo estado cada minuto lo moviera, cada tablet se bajaría el día
   * entero por datos móviles para enterarse de que no ha pasado nada.
   */
  const antes = await traerPorFolio('PAP-COTIZADO')

  const { json } = await avisar([{ pedidoId: antes.id, estado: 'cambiado', numero: 'F-1001' }])

  assert.deepEqual(json.aplicadas[0].guardado, [], 'no había nada nuevo que guardar')

  const despues = await traerPorFolio('PAP-COTIZADO')

  assert.equal(despues.updatedAt.getTime(), antes.updatedAt.getTime())
})

test('el costo recalculado pisa al viejo, y se estampa la tasa', async () => {
  const antes = await traerPorFolio('PAP-COTIZADO')

  assert.equal(antes.costoDomicilio, 4.5)

  const { json } = await avisar([
    { pedidoId: antes.id, estado: 'cambiado', numero: 'F-1001', costo: 3.2, distanciaKm: 7.5 },
  ])

  assert.ok(json.aplicadas[0].guardado.includes('costo'))

  const despues = await traerPorFolio('PAP-COTIZADO')

  // Se facturó menos de lo que se pidió: el domicilio se cobra por peso, así que baja.
  assert.equal(despues.costoDomicilio, 3.2)
})

test('el estado de la factura SALE también en el payload que lee la tablet', async () => {
  /**
   * Guardarlo y no mandarlo dejaba el dato encerrado en el panel. Quien más lo necesita
   * es el vendedor con su tablet: ve el pedido tal como lo tomó y, sin esto, no puede
   * saber que en el almacén se facturó otra cosa.
   */
  const p = await traerPorFolio('PAP-COTIZADO')

  await avisar([{ pedidoId: p.id, estado: 'cambiado', numero: 'F-1001' }])

  const { json } = await pedir('limit=50')
  const salida = porFolio(json.orders, 'PAP-COTIZADO')

  assert.equal(salida.facturaEstado, 'cambiado')
  assert.equal(salida.facturaNumero, 'F-1001')
  assert.ok(salida.facturaAt)
})

test('un costo NULO no pone el domicilio a cero', async () => {
  /**
   * `Number(null)` es CERO, no NaN. Delivery manda `costo: null` en todos los pedidos
   * cuya factura no cambió el peso —que son casi todos—, así que sin esta comprobación
   * cada pasada dejaba el día entero con el domicilio en cero. Y un cero no parece un
   * dato que falta: parece un domicilio gratis.
   */
  const antes = await traerPorFolio('PAP-COTIZADO')

  await avisar([{ pedidoId: antes.id, estado: 'igual', numero: 'F-1002', costo: null }])

  const despues = await traerPorFolio('PAP-COTIZADO')

  assert.equal(despues.costoDomicilio, antes.costoDomicilio)
  assert.equal(despues.facturaNumero, 'F-1002', 'el estado sí tenía que entrar')
})

test('un estado que no existe se rechaza en vez de guardarse', async () => {
  const p = await traerPorFolio('PAP-SIN-COSTO')
  const { json } = await avisar([{ pedidoId: p.id, estado: 'facturadisimo' }])

  assert.equal(json.aplicadas.length, 0)
  assert.equal(json.rechazadas.length, 1)
  assert.equal((await traerPorFolio('PAP-SIN-COSTO')).facturaEstado, null)
})

test('un pedido que no está aquí se rechaza con su motivo, y el resto del lote entra', async () => {
  const bueno = await traerPorFolio('PAP-SIN-DOMICILIO')

  const { json } = await avisar([
    { pedidoId: 'no-existe-este-id', estado: 'igual', numero: 'F-9' },
    { pedidoId: bueno.id, estado: 'igual', numero: 'F-2002' },
  ])

  // Que un id venga mal no es razón para descartar los otros que venían bien.
  assert.equal(json.aplicadas.length, 1)
  assert.equal(json.rechazadas.length, 1)
  assert.equal((await traerPorFolio('PAP-SIN-DOMICILIO')).facturaNumero, 'F-2002')
})

test('sin la clave de servicio no se escribe nada', async () => {
  const p = await traerPorFolio('PAP-VIEJO')
  const r = await fetch(`${BASE}/integration/orders/invoicing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ facturas: [{ pedidoId: p.id, estado: 'igual' }] }),
  })

  assert.ok(r.status === 401 || r.status === 403, `contestó ${r.status}`)
  assert.equal((await traerPorFolio('PAP-VIEJO')).facturaEstado, null)
})

test.after(async () => {
  await prisma.$disconnect()
})
