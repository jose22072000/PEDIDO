import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parsearFechaConsulta } from '../src/lib/fechaConsulta.ts';

/**
 * El 06/08/2026 la lista de pedidos devolvió tres 500 seguidos porque una fecha
 * de la URL no se podía leer y se pasaba tal cual a Prisma. Si alguna de estas
 * pruebas cae, ese 500 ha vuelto.
 */

describe('fecha de la URL', () => {
  test('una fecha normal se lee', () => {
    const { fecha, error } = parsearFechaConsulta('2026-08-06', 'desde');

    assert.equal(error, undefined);
    assert.equal(fecha?.toISOString(), '2026-08-06T00:00:00.000Z');
  });

  test('el límite "hasta" coge el día completo', () => {
    // Sin esto, filtrar "hasta el 6" dejaría fuera todo lo del día 6 salvo lo de
    // las 00:00 — da de menos y no se nota.
    const { fecha } = parsearFechaConsulta('2026-08-06', 'hasta', true);

    assert.equal(fecha?.toISOString(), '2026-08-06T23:59:59.999Z');
  });

  test('vacío no es un error: es "sin filtro"', () => {
    for (const v of ['', undefined, null]) {
      const { fecha, error } = parsearFechaConsulta(v, 'desde');

      assert.equal(fecha, null);
      assert.equal(error, undefined);
    }
  });

  test('EL FALLO REAL: el año de más de cuatro cifras se rechaza', () => {
    // `<input type="date">` deja teclear "202026" en el año. Esto llegó a
    // producción y tumbó la lista de pedidos tres veces.
    const { fecha, error } = parsearFechaConsulta('202026-08-06', 'desde');

    assert.equal(fecha, null);
    assert.ok(error, 'tiene que dar error, no una Invalid Date');
    assert.match(error, /AAAA-MM-DD/);
  });

  test('una fecha que no existe se rechaza en vez de desbordarse', () => {
    // Cumple el formato, pero el 31 de febrero no existe: `new Date` lo movería
    // calladamente al 3 de marzo y el filtro devolvería otros días.
    const { fecha, error } = parsearFechaConsulta('2026-02-31', 'desde');

    assert.equal(fecha, null);
    assert.match(String(error), /no existe/);
  });

  test('mes 13 y día 00 también', () => {
    assert.ok(parsearFechaConsulta('2026-13-01', 'desde').error);
    assert.ok(parsearFechaConsulta('2026-08-00', 'desde').error);
    assert.ok(parsearFechaConsulta('2026-08-32', 'desde').error);
  });

  test('basura y formatos de otro sitio se rechazan', () => {
    for (const v of ['basura', '06/08/2026', '2026-8-6', '2026-08', 'NaN']) {
      assert.ok(parsearFechaConsulta(v, 'desde').error, `${v} tenía que fallar`);
    }
  });

  test('el 29 de febrero bisiesto SÍ vale', () => {
    assert.equal(parsearFechaConsulta('2028-02-29', 'desde').error, undefined);
    assert.ok(parsearFechaConsulta('2027-02-29', 'desde').error);
  });

  test('el error dice qué campo y qué se recibió', () => {
    const { error } = parsearFechaConsulta('202026-08-06', 'fechaDesde');

    assert.match(String(error), /fechaDesde/);
    assert.match(String(error), /202026-08-06/);
  });
});
