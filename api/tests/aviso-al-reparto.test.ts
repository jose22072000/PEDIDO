/**
 * El aviso que PEDIDO le deja al reparto cuando cambia un pedido.
 *
 * Lo que se prueba aquí es lo que decide QUÉ se manda, que es lo que puede romperse en
 * silencio: un campo `undefined` hace que Redis rechace el aviso entero y el pedido no
 * llega nunca — y eso no da error en ningún sitio, simplemente no aparece en el reparto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  armarAviso,
  avisosEncendidos,
  leInteresaAlReparto,
} from '../src/lib/avisoAlReparto';

// ------------------------------------------------------------------ qué se avisa

test('sólo los pedidos: el reparto no usa clientes ni usuarios', () => {
  assert.equal(leInteresaAlReparto('pedido'), true);
  for (const otra of ['cliente', 'usuario', 'vendedor', 'meta', 'tasa', 'webhook']) {
    assert.equal(leInteresaAlReparto(otra), false, otra);
  }
});

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

test('el aviso lleva lo justo para saber qué pedir', () => {
  const a = armarAviso('pedido', { id: 'abc', sucursalId: 'cam', accion: 'update' }, () => 1700);

  assert.deepEqual(a, {
    entidad: 'pedido',
    accion: 'update',
    id: 'abc',
    sucursalId: 'cam',
    ts: '1700',
  });
});

test('NINGÚN CAMPO PUEDE IR VACÍO DE VERDAD', () => {
  // Con un `undefined` o un `null` dentro, Redis rechaza el XADD completo y el aviso no
  // se manda: el pedido no llega al reparto y no hay error en ninguna parte.
  const a = armarAviso('pedido', {}, () => 1);

  for (const [campo, valor] of Object.entries(a)) {
    assert.equal(typeof valor, 'string', `${campo} tiene que ser texto, es ${typeof valor}`);
    assert.notEqual(valor, undefined);
  }
  assert.equal(a.id, '');
  assert.equal(a.sucursalId, '');
});

test('un aviso de tanda va sin id: es «mira esta sucursal entera»', () => {
  const a = armarAviso('pedido', { sucursalId: 'stgo', accion: 'bulk' }, () => 2);

  assert.equal(a.id, '');
  assert.equal(a.accion, 'bulk');
  assert.equal(a.sucursalId, 'stgo');
});

test('sin acción, «change»: nunca se manda un aviso sin decir qué pasó', () => {
  assert.equal(armarAviso('pedido', { id: 'x' }, () => 3).accion, 'change');
});

test('la hora va en texto y en milisegundos, para poder medir el retraso', () => {
  const a = armarAviso('pedido', { id: 'x' }, () => 1_759_000_000_000);

  assert.equal(a.ts, '1759000000000');
  assert.ok(Number(a.ts) > 0);
});
