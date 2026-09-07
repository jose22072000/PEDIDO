/**
 * Los extremos de un día de Cuba.
 *
 * Se prueba porque el fallo no se ve: la pantalla enseña una lista que parece correcta y le
 * faltan los pedidos de una hora. Y los dos días que fallan son dos al año, así que se
 * descubriría en marzo mirando por qué no cuadra un día de hace ocho meses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extremosDelDia, inicioDelDia } from '../src/lib/diaCubano';

/** Cómo se ve ese instante en Cuba, para comprobar que el extremo cae donde toca. */
const enCuba = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);

test('en verano Cuba va a UTC-4', () => {
  assert.equal(inicioDelDia('2026-09-07')?.toISOString(), '2026-09-07T04:00:00.000Z');
});

test('en invierno va a UTC-5', () => {
  assert.equal(inicioDelDia('2026-12-15')?.toISOString(), '2026-12-15T05:00:00.000Z');
});

test('el día empieza a las 00:00 de Cuba y acaba a las 23:59, también en verano', () => {
  const r = extremosDelDia('2026-09-07')!;

  assert.equal(enCuba(r.desde), '2026-09-07, 00:00');
  assert.equal(enCuba(r.hasta), '2026-09-07, 23:59');
});

test('el día que se adelanta el reloj empieza a la 01:00, porque las 00:00 no existen', () => {
  // Cuba adelanta el reloj a medianoche: las 23:59:59 del 7 las sigue la 01:00:00 del 8.
  // La hora local «2026-03-08 00:00» no ocurre nunca, así que el primer instante del día es
  // la 01:00. Buscando las 00:00 a secas se acababa en las 23:00 del día ANTERIOR, y el
  // día se llevaba una hora de pedidos que no eran suyos.
  const r = extremosDelDia('2026-03-08')!;

  assert.equal(enCuba(r.desde), '2026-03-08, 01:00');
  assert.equal(r.desde.toISOString(), '2026-03-08T05:00:00.000Z');
});

test('y no se come la medianoche del día siguiente', () => {
  // Con «más 24 horas» el 8 de marzo terminaba a las 00:59 del 9: los pedidos de esa hora
  // salían contados dos veces, en los dos días.
  const r = extremosDelDia('2026-03-08')!;

  assert.equal(enCuba(r.hasta).startsWith('2026-03-08'), true);
});

test('el día que se atrasa el reloj llega hasta su última hora', () => {
  // Con «más 24 horas» el 1 de noviembre acababa a las 22:59 y se perdía la última hora.
  const r = extremosDelDia('2026-11-01')!;

  assert.equal(enCuba(r.desde), '2026-11-01, 00:00');
  assert.equal(enCuba(r.hasta), '2026-11-01, 23:59');
});

test('los dos extremos nunca se solapan con los del día de al lado', () => {
  for (const dia of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01', '2026-09-07']) {
    const hoy = extremosDelDia(dia)!;
    const manana = extremosDelDia(
      new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10),
    )!;

    assert.equal(hoy.hasta.getTime() + 1, manana.desde.getTime(), `se solapan en ${dia}`);
  }
});

test('una fecha que no tiene forma de fecha devuelve null', () => {
  assert.equal(extremosDelDia('7 de septiembre'), null);
  assert.equal(extremosDelDia('2026-13-45'), null);
});
