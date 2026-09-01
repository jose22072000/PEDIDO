/**
 * Atar cada factura a UN pedido, por el folio de su nota.
 *
 * Esto salió de un fallo real y caro. Se emparejaba por NOMBRE DE CLIENTE, y con eso no
 * se puede: CAFETERIA POLO pidió el 30 y el 31 de agosto, y la factura 1024237 acabó
 * pegada a los DOS pedidos —uno completado y otro en proceso—. Ninguno de los dos decía
 * la verdad, y el que estaba mal parecía correcto.
 *
 * La regla es simple y no admite excepciones: una factura nombra un folio, y va a ese
 * pedido. Si no nombra ninguno, no va a ninguna parte.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { facturasPorFolio, folioDeLaNota } from '../src/lib/emparejarFactura.ts'

test('LA NOTA REAL de Ventra: se lee el folio de la etiqueta P-', () => {
  // Tal cual llega en producción, con sus tres partes etiquetadas.
  assert.equal(
    folioDeLaNota('P-PXC25-260831-1337; V-XENIA CORDIEZ MORASEN; C-LH15TCP0295;'),
    'PXC25-260831-1337',
  )
  // Y el código del cliente que va detrás no se confunde con el folio.
  assert.notEqual(folioDeLaNota('P-PXC25-260831-1337; C-LH15TCP0295;'), 'LH15TCP0295')
})

test('las ventas de mostrador no tienen pedido: no emparejan con nada', () => {
  // Son un tercio de las líneas y es correcto que no aten a ningún pedido.
  assert.equal(folioDeLaNota('VENTA ALMACEN'), null)
  assert.equal(folioDeLaNota('V-RAYDEL MESA GUTIERREZ;'), null)
})

test('el folio se saca de la nota, venga solo o con texto alrededor', () => {
  assert.equal(folioDeLaNota('PMH25-260901-1001'), 'PMH25-260901-1001')
  assert.equal(folioDeLaNota('pedido PLB25-260831-1585 entregado'), 'PLB25-260831-1585')
  // Con el sufijo que añade la importación cuando dos clientes comparten folio.
  assert.equal(folioDeLaNota('PGD26-260831-2531-1'), 'PGD26-260831-2531-1')
})

test('una nota sin folio no empareja nada', () => {
  assert.equal(folioDeLaNota('recoger en el almacén'), null)
  assert.equal(folioDeLaNota(''), null)
  assert.equal(folioDeLaNota(null), null)
})

test('cada factura va a UN folio, y una factura no se reparte', () => {
  const mapa = facturasPorFolio([
    { operNumber: '1024237', nota: 'PLB25-260831-1585' },
    // La misma factura tiene una línea por producto: el folio sale igual.
    { operNumber: '1024237', nota: 'PLB25-260831-1585' },
    { operNumber: '1024240', nota: 'PLB25-260830-1576' },
  ])

  assert.deepEqual([...(mapa.get('PLB25-260831-1585') ?? [])], ['1024237'])
  assert.deepEqual([...(mapa.get('PLB25-260830-1576') ?? [])], ['1024240'])
})

test('EL FALLO DE VERDAD: la factura del 31 no toca el pedido del 30', () => {
  /**
   * Es el caso exacto que se rompió. Dos pedidos del mismo cliente, días seguidos, la
   * misma mercancía. Por nombre de cliente los dos parecían dueños de la misma factura.
   */
  const mapa = facturasPorFolio([{ operNumber: '1024237', nota: 'PLB25-260831-1585' }])

  assert.deepEqual([...(mapa.get('PLB25-260831-1585') ?? [])], ['1024237'])
  assert.equal(mapa.get('PLB25-260830-1576'), undefined, 'el del 30 no puede quedarse esa factura')
})

test('un pedido facturado en DOS documentos se queda con los dos', () => {
  // Esto sí pasa y es legítimo: se factura en dos partes. Lo contrario —una factura
  // repartida entre dos pedidos— es lo que no puede ocurrir.
  const mapa = facturasPorFolio([
    { operNumber: '1024202', nota: 'PRM25-260831-1797' },
    { operNumber: '1024269', nota: 'PRM25-260831-1797' },
  ])

  assert.deepEqual([...(mapa.get('PRM25-260831-1797') ?? [])].sort(), ['1024202', '1024269'])
})

test('las facturas sin nota se quedan fuera, no se reparten a ojo', () => {
  const mapa = facturasPorFolio([
    { operNumber: '99', nota: null },
    { operNumber: '98', nota: 'venta de mostrador' },
  ])

  assert.equal(mapa.size, 0)
})
