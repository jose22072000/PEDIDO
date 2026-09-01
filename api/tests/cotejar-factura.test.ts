/**
 * Cotejar el pedido con la factura.
 *
 * Es lo que decide qué sale en el camión. Si dice «igual» cuando no lo es, se carga de
 * más y se cobra de menos; si dice «cambiado» cuando sí cuadra, ese pedido se queda sin
 * repartir. Las dos cosas se ven al final del día, y para entonces ya pasó.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, mismoProducto, clavesDeProducto } from '../src/lib/cotejarFactura.ts'

// Los nombres REALES: Ventra escribe el formato en mililitros y el pedido en litros.
const FACTURA = [
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 },
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'MALTA GUAJIRA 1500 ML BLISTER 6U', cantidad: 10 },
]

test('«PARRANDA 1.5L» y «CERVEZA PARRANDA 1500 ML BLISTER 6U» son el mismo producto', () => {
  assert.ok(mismoProducto('PARRANDA 1.5L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'))
  assert.ok(clavesDeProducto('PARRANDA 1.5L').has('1500'), 'el litro no se pasó a mililitros')
})

test('pero NO confunde formatos de la misma marca', () => {
  // Con una sola palabra en común —«parranda»— casaría cualquier formato con cualquiera,
  // y el cotejo diría que cuadra cuando lo que se lleva es otra cosa.
  assert.equal(mismoProducto('PARRANDA 0.33L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'), false)
})

test('lo que cuadra sale como igual, con su número de factura', () => {
  const r = cotejar(
    [
      { producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 },
      { producto: 'MALTA GUAJIRA 1.5L', packs: 10, unidades: 60 },
    ],
    FACTURA,
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160')
  assert.deepEqual(r.diferencias, [])
})

test('lo que cambió lo DICE, con las cantidades de los dos lados', () => {
  const r = cotejar([{ producto: 'PARRANDA 1.5L', packs: 25 }], FACTURA)

  assert.equal(r.estado, 'cambiado')
  // Y se dice en qué: se pidieron 25 y se facturaron 20. Sin eso, «cambiado» a secas
  // obliga a abrir Ventra para saber qué pasó.
  assert.match(r.diferencias.join(' | '), /pedido 25, facturado 20/)
  // Lo facturado y no pedido también cuenta.
  assert.match(r.diferencias.join(' | '), /MALTA GUAJIRA .*facturado 10, no pedido/)
})

test('sin ninguna factura suya, se dice: no se inventa un encaje', () => {
  /**
   * De quién es cada factura ya no se decide aquí: lo decide el folio de la nota, en
   * `emparejarFactura`. Aquí sólo llegan las que son de ESTE pedido, y cuando no hay
   * ninguna se dice, en vez de buscarle una parecida.
   */
  const r = cotejar([{ producto: 'PARRANDA 1.5L', packs: 20 }], [])

  assert.equal(r.estado, 'sin_factura')
  assert.equal(r.numero, null)
})

test('dos facturas del mismo cliente el mismo día se cotejan JUNTAS', () => {
  /**
   * Pasa cuando el pedido se factura en dos documentos. Compararlo contra una sola diría
   * «cambiado» siempre, y media ruta se quedaría fuera.
   */
  const dos = [
    ...FACTURA,
    { operNumber: '1024199', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'ARROZ CAMIL 1 KG PACA 10U', cantidad: 5 },
  ]
  const r = cotejar(
    [
      { producto: 'PARRANDA 1.5L', packs: 20 },
      { producto: 'MALTA GUAJIRA 1.5L', packs: 10 },
      { producto: 'ARROZ CAMIL 1 KG', packs: 5 },
    ],
    dos,
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160, 1024199')
})

// ---------------------------------------------------- el cobro del reparto no es carga

test('la línea de ENTREGA A DOMICILIO no cuenta como mercancía', () => {
  /**
   * Ventra factura el reparto como una línea más. Dejándola dentro, TODOS los pedidos a
   * domicilio salían «cambiados» —esa línea nunca está en el pedido—, y encima se copiaba
   * al pedido como si fuera algo que hay que subir al camión.
   */
  const r = cotejar(
    [{ producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 }],
    [
      { operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 },
      { operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'ENTREGA A DOMICILIO', cantidad: 1, precioUsd: 4.5 },
    ],
  )

  assert.equal(r.estado, 'igual', 'el domicilio facturado no puede convertir el pedido en «cambiado»')
  assert.equal(r.lineas.length, 1, 'sólo la mercancía')
  // Y lo que cobró sí se guarda: es lo que de verdad pagó el cliente por el reparto.
  assert.equal(r.domicilioFacturado, 4.5)
})

test('sin línea de domicilio, no se inventa un cobro', () => {
  const r = cotejar(
    [{ producto: 'PARRANDA 1.5L', packs: 20, unidades: 120 }],
    [{ operNumber: '99', clienteNombre: 'LA CHIQUI', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 }],
  )

  // null y no cero: cero se lee como «se repartió gratis», y esto es «se recogió».
  assert.equal(r.domicilioFacturado, null)
})
