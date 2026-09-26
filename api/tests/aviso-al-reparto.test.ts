/**
 * El aviso que PEDIDO le deja al reparto cuando cambia un pedido.
 *
 * Lo que se prueba aquí es lo que decide QUÉ se manda, que es lo que puede romperse en
 * silencio: un campo `undefined` hace que Redis rechace el aviso entero y el pedido no
 * llega nunca — y eso no da error en ningún sitio, simplemente no aparece en el reparto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { armarAviso, avisosEncendidos } from '../src/lib/avisoAlReparto';

// ------------------------------------------------------------------ el interruptor

test('apagado por defecto: sin la variable, PEDIDO se comporta como antes', () => {
  assert.equal(avisosEncendidos({}), false);
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: '' }), false);
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: 'false' }), false);
  // Un `0` o un `si` heredados de otro sitio no lo encienden: sólo «true».
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: '0' }), false);
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: 'si' }), false);
});

test('y encendido con «true», aunque venga con mayúsculas o espacios', () => {
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: 'true' }), true);
  assert.equal(avisosEncendidos({ DELIVERY_EVENTS: ' TRUE ' }), true);
});

// ------------------------------------------------------------------ el contenido

test('el aviso lleva lo justo para saber qué pedir, y POR QUÉ', () => {
  const a = armarAviso({ id: 'abc', sucursalId: 'cam', motivo: 'factura', accion: 'cambiado' }, () => 1700);

  assert.deepEqual(a, {
    entidad: 'pedido',
    motivo: 'factura',
    accion: 'cambiado',
    id: 'abc',
    sucursalId: 'cam',
    ts: '1700',
  });
});

test('los cuatro motivos son los que el reparto sabe atender', () => {
  // Si aparece uno nuevo, el consumidor tiene que aprender qué hacer con él: que la
  // lista viva en un sitio es lo que evita que se invente un motivo por el camino.
  for (const motivo of ['factura', 'domicilio', 'importacion', 'borrado'] as const) {
    assert.equal(armarAviso({ motivo }, () => 1).motivo, motivo);
  }
});

test('NINGÚN CAMPO PUEDE IR VACÍO DE VERDAD', () => {
  // Con un `undefined` o un `null` dentro, Redis rechaza el XADD completo y el aviso no
  // se manda: el pedido no llega al reparto y no hay error en ninguna parte.
  const a = armarAviso({ motivo: 'factura' }, () => 1);

  for (const [campo, valor] of Object.entries(a)) {
    assert.equal(typeof valor, 'string', `${campo} tiene que ser texto, es ${typeof valor}`);
    assert.notEqual(valor, undefined);
  }
  assert.equal(a.id, '');
  assert.equal(a.sucursalId, '');
});

test('un aviso de tanda va sin id: es «mira esta sucursal entera»', () => {
  const a = armarAviso({ sucursalId: 'stgo', motivo: 'importacion', accion: 'bulk' }, () => 2);

  assert.equal(a.id, '');
  assert.equal(a.accion, 'bulk');
  assert.equal(a.sucursalId, 'stgo');
});

test('sin acción, «change»: nunca se manda un aviso sin decir qué pasó', () => {
  assert.equal(armarAviso({ id: 'x', motivo: 'factura' }, () => 3).accion, 'change');
});

test('la hora va en texto y en milisegundos, para poder medir el retraso', () => {
  const a = armarAviso({ id: 'x', motivo: 'domicilio' }, () => 1_759_000_000_000);

  assert.equal(a.ts, '1759000000000');
  assert.ok(Number(a.ts) > 0);
});
