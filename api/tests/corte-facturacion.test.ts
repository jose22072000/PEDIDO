/**
 * El corte que separa «todavía no» de «no apareció».
 *
 * Se prueba porque de él depende a quién se persigue. Si el corte se adelanta, la pantalla
 * marca como perdidos pedidos que se van a facturar dentro de un rato y nadie vuelve a
 * creerse la lista. Si se atrasa, los de verdad perdidos no salen hasta el día siguiente.
 *
 * Y va con hora de Cuba a propósito: el servidor corre en UTC, donde las 18:30 de allí son
 * las 22:30. Con la hora del servidor, el corte caería a las dos de la tarde.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enCuba, estadoDeFactura, yaCerroElDia } from '../src/lib/corteFacturacion';

// Cuba en septiembre va a UTC-4.
const cuba = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-04:00`);

test('lee el día y la hora en Cuba, no en UTC', () => {
  // Las 21:00 de Cuba son las 01:00 UTC del día siguiente: el día tiene que ser el de Cuba.
  const r = enCuba(new Date('2026-09-08T01:00:00Z'));

  assert.equal(r.dia, '2026-09-07');
  assert.equal(r.hora, 21);
});

test('un pedido de hoy antes del corte sigue esperando', () => {
  const ahora = cuba('2026-09-07', '11:00');

  assert.equal(yaCerroElDia(cuba('2026-09-07', '09:00'), ahora), false);
});

test('pasado el corte, el día de hoy ya cerró', () => {
  const ahora = cuba('2026-09-07', '18:31');

  assert.equal(yaCerroElDia(cuba('2026-09-07', '09:00'), ahora), true);
});

test('justo a las 18:30 ya cuenta como cerrado', () => {
  assert.equal(yaCerroElDia(cuba('2026-09-07', '09:00'), cuba('2026-09-07', '18:30')), true);
});

test('un pedido de un día anterior está cerrado a cualquier hora', () => {
  assert.equal(yaCerroElDia(cuba('2026-09-06', '09:00'), cuba('2026-09-07', '07:00')), true);
});

test('la medianoche de Cuba no se lee como hora 24', () => {
  // Con `hour12:false` algunos entornos dan 24 para la medianoche. Si se colara, un pedido
  // de las 00:10 saldría «no apareció» diez minutos después de tomarlo.
  const ahora = cuba('2026-09-07', '00:10');

  assert.equal(enCuba(ahora).hora < 1, true);
  assert.equal(yaCerroElDia(cuba('2026-09-07', '00:05'), ahora), false);
});

test('facturado y cambiado están los dos facturados', () => {
  const ahora = cuba('2026-09-07', '20:00');

  assert.equal(estadoDeFactura('igual', cuba('2026-09-07', '09:00'), ahora), 'facturado');
  assert.equal(estadoDeFactura('cambiado', cuba('2026-09-07', '09:00'), ahora), 'cambiado');
});

test('sin factura son dos cosas según la hora', () => {
  const dia = cuba('2026-09-07', '09:00');

  assert.equal(estadoDeFactura('sin_factura', dia, cuba('2026-09-07', '11:00')), 'buscando');
  assert.equal(estadoDeFactura('sin_factura', dia, cuba('2026-09-07', '20:00')), 'no_aparecio');
});

test('el que el cotejo no ha tocado no se cuenta como perdido', () => {
  // `null` es «no he pasado por él», no «no tiene factura». Decir que no apareció sería
  // acusar de perdido a un pedido que nadie ha mirado.
  assert.equal(estadoDeFactura(null, cuba('2026-09-01', '09:00'), cuba('2026-09-07', '20:00')), 'sin_cotejar');
});

test('una fecha ilegible no cierra el día', () => {
  assert.equal(yaCerroElDia('esto no es una fecha'), false);
  assert.equal(yaCerroElDia(null), false);
});
