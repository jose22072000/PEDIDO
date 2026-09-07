/**
 * El sufijo del folio significa dos cosas distintas y tienen la misma forma.
 *
 * Nuestra importación añade `-1` cuando dos clientes comparten folio, y ese sufijo es
 * parte del folio. Ventra añade otro, con la misma pinta, que es el número de documento
 * dentro del pedido. Confundirlos deja pedidos en «sin factura» para siempre — o, peor,
 * pega la factura de un pedido a otro, que es lo que pasó en julio con 40 de 207.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { facturasHuerfanasSinSufijo, folioSinSufijo } from '../src/lib/emparejarFactura';

test('quita el sufijo de línea que añade Ventra', () => {
  assert.equal(folioSinSufijo('PDG26-260906-2992-2'), 'PDG26-260906-2992');
  assert.equal(folioSinSufijo('POR26-260906-3401-1'), 'POR26-260906-3401');
});

test('un folio sin sufijo se queda igual', () => {
  assert.equal(folioSinSufijo('PLB25-260906-1588'), 'PLB25-260906-1588');
});

test('normaliza mayúsculas y espacios', () => {
  assert.equal(folioSinSufijo('  pdg26-260906-2992-2 '), 'PDG26-260906-2992');
});

test('lo que no tiene forma de folio no se toca', () => {
  assert.equal(folioSinSufijo('VENTA ALMACEN'), 'VENTA ALMACEN');
});

test('el respaldo recoge la factura huérfana bajo el folio sin sufijo', () => {
  const porFolio = new Map([['PDG26-260906-2992-2', new Set(['43639'])]]);
  const nuestros = new Set(['PDG26-260906-2992']);

  const r = facturasHuerfanasSinSufijo(porFolio, nuestros);

  assert.deepEqual([...(r.get('PDG26-260906-2992') ?? [])], ['43639']);
});

test('NO le quita el sufijo a una factura que ya tiene dueño exacto', () => {
  // Ésta es la salvaguarda contra lo de julio: existe nuestro pedido `X-1337-1`, así que
  // su factura es suya y no puede acabar además en el pedido `X-1337`.
  const porFolio = new Map([['PXC25-260831-1337-1', new Set(['999'])]]);
  const nuestros = new Set(['PXC25-260831-1337-1', 'PXC25-260831-1337']);

  const r = facturasHuerfanasSinSufijo(porFolio, nuestros);

  assert.equal(r.size, 0);
});

test('junta las facturas de varias líneas del mismo pedido', () => {
  const porFolio = new Map([
    ['PTB25-260906-1093-1', new Set(['43629'])],
    ['PTB25-260906-1093-2', new Set(['43640'])],
  ]);

  const r = facturasHuerfanasSinSufijo(porFolio, new Set(['PTB25-260906-1093']));

  assert.deepEqual([...(r.get('PTB25-260906-1093') ?? [])].sort(), ['43629', '43640']);
});
