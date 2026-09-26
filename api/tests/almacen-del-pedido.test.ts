/**
 * De qué almacén sale un pedido.
 *
 * Esto decide DESDE DÓNDE mide el reparto, y de ese kilometraje sale el costo del
 * domicilio. Equivocarse aquí no da error en ninguna parte: da un precio creíble.
 *
 * El caso que lo hizo necesario: en Santiago conviven AURORA y PV-STGO, y **dos de cada
 * tres pedidos salen de AURORA**. Con un solo almacén por sucursal daba igual; con dos,
 * medir siempre desde el principal es cobrar mal la mayoría de los domicilios de esa
 * sucursal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { almacenDelPedido } from '../src/lib/almacenDelPedido';

const lineas = (...ls: Array<[string | null, string | null]>) =>
  JSON.stringify(ls.map(([almacenCodigo, almacenNombre]) => ({ producto: 'X', almacenCodigo, almacenNombre })));

test('lo normal: todos los renglones del mismo almacén', () => {
  assert.deepEqual(almacenDelPedido(lineas(['2', 'AURORA'], ['2', 'AURORA'])), {
    codigo: '2',
    nombre: 'AURORA',
    mezclado: false,
  });
});

test('mezclado: manda el que pone más renglones, y se dice que está mezclado', () => {
  // Tres de AURORA y uno de PV-STGO: se mide desde AURORA, pero hay DOS recogidas.
  const r = almacenDelPedido(lineas(['2', 'AURORA'], ['1', 'PV-STGO'], ['2', 'AURORA'], ['2', 'AURORA']));

  assert.deepEqual(r, { codigo: '2', nombre: 'AURORA', mezclado: true });
});

test('sin factura no hay almacén, y eso es NULO, no un almacén cualquiera', () => {
  // Decir uno por decir alguno es justo el número creíble y equivocado que se viene a
  // quitar: se prefiere «no se sabe», que el otro lado sí puede tratar.
  assert.equal(almacenDelPedido(null), null);
  assert.equal(almacenDelPedido(''), null);
  assert.equal(almacenDelPedido(lineas([null, null])), null);
});

test('las líneas que no se facturaron no cuentan', () => {
  // Las marcadas `falta` van sin almacén: no salieron de ningún sitio. Si contaran,
  // un pedido con un producto que no se facturó podría cambiar de almacén.
  assert.deepEqual(almacenDelPedido(lineas(['1', 'PV-STGO'], [null, null], [null, null])), {
    codigo: '1',
    nombre: 'PV-STGO',
    mezclado: false,
  });
});

test('un JSON ilegible no deja al pedido sin salir', () => {
  assert.equal(almacenDelPedido('{roto'), null);
  assert.equal(almacenDelPedido('"no es una lista"'), null);
});
