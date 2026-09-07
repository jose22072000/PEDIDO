/**
 * El prefijo con el que el carril rápido le pide facturas a Ventra.
 *
 * Se prueba porque un prefijo mal sacado no da error: da CERO facturas. El cotejo seguiría
 * corriendo cada treinta segundos diciendo que ningún pedido tiene factura, y nadie vería
 * un fallo en ninguna parte — sólo pedidos que no se facturan nunca.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prefijoDeFolio } from '../src/lib/emparejarFactura';

test('saca sucursal y día, sin el número del pedido', () => {
  assert.equal(prefijoDeFolio('P-PDG26-260907-2988'), 'P-PDG26-260907');
  assert.equal(prefijoDeFolio('P-PXC25-260831-1337'), 'P-PXC25-260831');
});

test('el folio de la nota de Ventra lleva además un sufijo, y tampoco entra', () => {
  // Ventra escribe `P-PDG26-260906-2992-2`: el `-2` es la línea, no el pedido.
  assert.equal(prefijoDeFolio('P-PDG26-260906-2992-2'), 'P-PDG26-260906');
});

test('no distingue mayúsculas ni se cae por espacios de más', () => {
  assert.equal(prefijoDeFolio('  p-pdg26-260907-2988  '), 'P-PDG26-260907');
});

test('lo que no tiene forma de folio devuelve null, para caer al camino por fechas', () => {
  // Sin fecha de seis dígitos no se puede saber de qué día es.
  assert.equal(prefijoDeFolio('P-PDG26-XX-2988'), null);
  // Escritos a mano, o de antes de que existiera el folio.
  assert.equal(prefijoDeFolio('VENTA ALMACEN'), null);
  assert.equal(prefijoDeFolio('P-PDG26-260907'), null); // sin número: no es un folio entero
  assert.equal(prefijoDeFolio(''), null);
});
