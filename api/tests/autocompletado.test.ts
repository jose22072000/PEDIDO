/**
 * Un pedido con factura se completa solo. Y una vez completado, NO se le quita la
 * factura a la ligera.
 *
 * Las dos mitades van juntas porque el 23/09/2026 aparecieron **113 pedidos completados
 * «por la factura» que a la vez decían «no apareció»**. Dos cosas que no pueden ser
 * ciertas al mismo tiempo, y la pantalla las enseñaba juntas.
 *
 * No era el autocompletado —ése sólo completa con factura `igual` o `cambiado`—: era el
 * carril rápido del cotejo, que pregunta a Ventra por lo facturado HOY y le marcaba «sin
 * factura» a los pedidos de días anteriores que ya habían casado. Les pisaba una factura
 * buena porque miraba donde no estaba.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACTURADO,
  POR_LA_FACTURA,
  camposParaCompletar,
  conservaSuFactura,
} from '../src/lib/reglaFactura.ts';

// ---------------------------------------------------------------- completar

test('con factura se completa, y queda dicho que no lo hizo una persona', () => {
  const campos = camposParaCompletar('igual', 'en_proceso');

  assert.equal(campos?.estado, 'completada');
  assert.equal(campos?.completadoPor, POR_LA_FACTURA);
  assert.equal(campos?.completadoPorId, null);
});

test('el CAMBIADO también está facturado', () => {
  // Se facturó distinto de lo que se pidió, pero se facturó. La diferencia se ve en su
  // propio estado de factura; dejarlo «en proceso» sería decir que está sin hacer.
  assert.ok(camposParaCompletar('cambiado', 'en_proceso'));
  assert.ok(FACTURADO.has('cambiado'));
});

test('sin factura NO se completa: es justo lo que se vino a evitar', () => {
  assert.equal(camposParaCompletar('sin_factura', 'en_proceso'), null);
  assert.equal(camposParaCompletar(null, 'en_proceso'), null);
  assert.equal(camposParaCompletar(undefined, 'expirada'), null);
});

test('lo ya completado no se vuelve a completar', () => {
  // Repetirlo movería `completedAt` a hoy y borraría quién y cuándo lo completó de verdad.
  assert.equal(camposParaCompletar('igual', 'completada'), null);
});

// ------------------------------------------------------- no descasar a ciegas

test('una pasada que no cubre el día del pedido NO le quita la factura', () => {
  assert.equal(conservaSuFactura('igual', 'sin_factura', false), true);
  assert.equal(conservaSuFactura('cambiado', 'sin_factura', false), true);
});

test('la pasada que SÍ miró ese día puede descasarlo: la factura se pudo anular', () => {
  assert.equal(conservaSuFactura('igual', 'sin_factura', true), false);
});

test('lo que no tenía factura no tiene nada que conservar', () => {
  assert.equal(conservaSuFactura('sin_factura', 'sin_factura', false), false);
  assert.equal(conservaSuFactura(null, 'sin_factura', false), false);
});

test('y ENCONTRAR factura entra siempre, la cubra quien la cubra', () => {
  // La guarda es sólo contra el descenso. Subir de «no apareció» a «facturado» es la
  // noticia que se está esperando, y no se puede frenar.
  assert.equal(conservaSuFactura('sin_factura', 'igual', false), false);
  assert.equal(conservaSuFactura('igual', 'cambiado', false), false);
});
