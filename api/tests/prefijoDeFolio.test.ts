/**
 * El prefijo con el que el carril rápido le pide facturas a Ventra.
 *
 * Se prueba porque un prefijo mal sacado no da error: da CERO facturas. El cotejo seguiría
 * corriendo cada treinta segundos diciendo que ningún pedido tiene factura, y nadie vería
 * un fallo en ninguna parte — sólo pedidos que no se facturan nunca.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prefijoDeFolio, prefijoDeNota } from '../src/lib/emparejarFactura';

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

/**
 * `prefijoDeNota`: el mismo prefijo, pero a partir de NUESTRO folio.
 *
 * Esto es lo que rompía el carril rápido. Guardamos `PAT26-260920-1192` y en la nota de
 * Ventra está escrito `P-PAT26-260920-1192`; se le pasaba el folio tal cual a
 * `prefijoDeFolio`, que exige la `P-` delante, y devolvía `null` SIEMPRE. Sin prefijos,
 * el carril rápido se bajaba la facturación entera del día de cada sucursal, cada treinta
 * segundos, por la VPN — justo lo que esa optimización venía a evitar.
 */
test('de NUESTRO folio saca el prefijo con el que Ventra lo escribe', () => {
  assert.equal(prefijoDeNota('PAT26-260920-1192'), 'P-PAT26-260920');
  assert.equal(prefijoDeNota('PDG26-260907-2988'), 'P-PDG26-260907');
});

test('el sufijo nuestro no estorba: es el mismo día y la misma sucursal', () => {
  // `-1` separa a dos clientes del mismo folio; el prefijo de los dos es el mismo.
  assert.equal(prefijoDeNota('PDZ25-260912-2738-1'), 'P-PDZ25-260912');
  assert.equal(prefijoDeNota('PDZ25-260912-2738'), 'P-PDZ25-260912');
});

test('si ya viene con la P- no se la pone dos veces', () => {
  assert.equal(prefijoDeNota('P-PAT26-260920-1192'), 'P-PAT26-260920');
});

test('lo que no tiene forma de folio sigue devolviendo null', () => {
  // El de Alfredo va pegado (`PAH25-2609111134`): no se puede sacar el día, así que se
  // cae al camino por fechas. Preferible una consulta gorda que ninguna.
  assert.equal(prefijoDeNota('PAH25-2609111134'), null);
  assert.equal(prefijoDeNota('VENTA ALMACEN'), null);
  assert.equal(prefijoDeNota(''), null);
});
