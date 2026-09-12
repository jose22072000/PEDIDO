/**
 * Avisar cuando la factura de un pedido parece haber ido al folio de al lado.
 *
 * Sale de 30 pedidos de septiembre que se cerraron a mano como «completados» sin tener
 * factura. Trece de ellos SÍ tenían una, al mismo cliente y con las mismas cantidades,
 * pero escrita contra otro folio del mismo cliente.
 *
 * Avisa, no empareja: emparejar por cliente es el fallo de julio otra vez.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buscarFacturaEnOtroFolio } from '../src/lib/facturaEnOtroFolio.ts'

const PEDRO = {
  folio: 'PAA26-260911-1856',
  fecha: '2026-09-11',
  clienteCodigo: 'CM01TCP0622',
  clienteNombre: 'PEDRO ANGEL DIAZ QUEIJO',
  vendedor: 'ANDY JESUS ALMANZA LOPEZ',
  items: [
    { codigo: 'Parranda 0.5L', producto: 'CERVEZA PARRANDA 500 ML BLISTER 6U', packs: 10 },
    { codigo: 'RONE0009', producto: 'VODKA REGIO BLISTER 6U', packs: 10 },
  ],
}

/** La 18142 real: mismo cliente, mismas cantidades, folio del pedido de al lado. */
const LA_18142 = [
  {
    operNumber: '18142', fecha: '2026-09-11',
    nota: 'P-PAA26-260910-1842; V-ANDY JESUS ALMANZA LOPEZ; C-CM01TCP0622;',
    productoCodigo: 'RONE0009', productoNombre: 'VODKA REGIO BLISTER 6U', cantidad: 10,
  },
  {
    operNumber: '18142', fecha: '2026-09-11',
    nota: 'P-PAA26-260910-1842; V-ANDY JESUS ALMANZA LOPEZ; C-CM01TCP0622;',
    productoCodigo: 'PARR0002', productoNombre: 'CERVEZA PARRANDA 500 ML BLISTER 6U', cantidad: 10,
  },
]

test('EL CASO REAL: la factura fue al folio de al lado, del mismo cliente', () => {
  const [aviso] = buscarFacturaEnOtroFolio([PEDRO], LA_18142)

  assert.equal(aviso.folio, 'PAA26-260911-1856')
  assert.equal(aviso.candidatas.length, 1)
  assert.equal(aviso.candidatas[0].factura, '18142')
  assert.equal(aviso.candidatas[0].folioDeLaFactura, 'PAA26-260910-1842')
  assert.equal(aviso.candidatas[0].cuadraEntera, true)
})

test('el código malo no impide reconocer el producto: manda el NOMBRE', () => {
  // `HGH0013` no existe en Ventra —es `HGHG0014` con una G de menos—, pero el nombre de
  // la línea del pedido sí es el bueno.
  const pedido = {
    folio: 'PDZ25-260909-2728', fecha: '2026-09-09',
    clienteCodigo: 'CM01TCP9001', clienteNombre: 'TEOMIRA VARONA GONDRES', vendedor: 'DEYANIRA',
    items: [{ codigo: 'HGH0013', producto: 'HIGIENE-HOGAR PAPEL HIGIENICO MANATI 15M PACA 12P DE 4U', packs: 1 }],
  }
  const venta = [{
    operNumber: '18170', fecha: '2026-09-11',
    nota: 'P-PDZ25-260908-2721; V-DEYANIRA ZALDIVAR LUGO; C-CM01TCP9001;',
    productoCodigo: 'HGHG0014', productoNombre: 'PAPEL HIGIENICO MANATI 15 M PACA 12P DE 4U', cantidad: 1,
  }]

  const [aviso] = buscarFacturaEnOtroFolio(pedido ? [pedido] : [], venta)

  assert.equal(aviso.candidatas[0].cuadraEntera, true)
  assert.equal(aviso.candidatas[0].lineas[0].facturado, 'PAPEL HIGIENICO MANATI 15 M PACA 12P DE 4U')
})

test('si su PROPIO folio ya tiene factura no se avisa de nada', () => {
  const suya = LA_18142.map((l) => ({ ...l, nota: 'P-PAA26-260911-1856; C-CM01TCP0622;' }))

  assert.deepEqual(buscarFacturaEnOtroFolio([PEDRO], suya), [])
})

test('a otro cliente no se le mira, aunque sea el mismo día y el mismo producto', () => {
  const deOtro = LA_18142.map((l) => ({ ...l, nota: 'P-PAA26-260910-1842; C-CM01TCP9999;' }))

  assert.deepEqual(buscarFacturaEnOtroFolio([PEDRO], deOtro), [])
})

test('fuera de la ventana de días no se avisa', () => {
  const tarde = LA_18142.map((l) => ({ ...l, fecha: '2026-09-30' }))

  assert.deepEqual(buscarFacturaEnOtroFolio([PEDRO], tarde), [])
  // Y una factura ANTES del pedido tampoco: no se puede facturar lo que no se ha pedido.
  const antes = LA_18142.map((l) => ({ ...l, fecha: '2026-09-01' }))
  assert.deepEqual(buscarFacturaEnOtroFolio([PEDRO], antes), [])
})

test('cuando las cantidades no cuadran se avisa igual, pero se dice', () => {
  const mitad = LA_18142.map((l) => ({ ...l, cantidad: 5 }))
  const [aviso] = buscarFacturaEnOtroFolio([PEDRO], mitad)

  assert.equal(aviso.candidatas[0].cuadraEntera, false)
  assert.equal(aviso.candidatas[0].lineas.every((l) => l.cuadra === false), true)
})

test('sin código de cliente no hay por dónde buscar, y no se inventa', () => {
  const sinCodigo = { ...PEDRO, clienteCodigo: null }

  assert.deepEqual(buscarFacturaEnOtroFolio([sinCodigo], LA_18142), [])
})

test('la que cuadra entera sale primero', () => {
  const otra = [{
    operNumber: '18999', fecha: '2026-09-11',
    nota: 'P-PAA26-260910-1899; C-CM01TCP0622;',
    productoCodigo: 'PARR0002', productoNombre: 'CERVEZA PARRANDA 500 ML BLISTER 6U', cantidad: 3,
  }]
  const [aviso] = buscarFacturaEnOtroFolio([PEDRO], [...otra, ...LA_18142])

  assert.equal(aviso.candidatas.length, 2)
  assert.equal(aviso.candidatas[0].factura, '18142')
  assert.equal(aviso.candidatas[0].cuadraEntera, true)
})
