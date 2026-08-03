import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  apuntarFallo,
  esperaPendiente,
  olvidarFallos,
} from '../src/middleware/frenoLogin.ts';

/**
 * El freno de fuerza bruta tiene que cumplir DOS cosas a la vez, y una se
 * aprendió a la mala: frenar al atacante SIN bloquear a la sucursal.
 *
 * En el servidor viejo el límite era por IP (10/min en nginx). Como toda una
 * sucursal sale por una sola IP pública, tres personas entrando a las 8am
 * bloqueaban la oficina entera. De ahí que aquí se frene por USUARIO.
 */

describe('freno de login', () => {
  test('los primeros intentos no frenan a nadie', () => {
    const u = `libre-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 5; i++) {
      apuntarFallo(u);
      assert.equal(esperaPendiente(u), 0, `no debería frenar en el fallo ${i + 1}`);
    }
  });

  test('a partir de la tolerancia empieza a frenar, y va a más', () => {
    const u = `castigo-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 6; i++) apuntarFallo(u);
    const primera = esperaPendiente(u);

    assert.ok(primera > 0, 'el sexto fallo ya debería frenar');

    apuntarFallo(u);
    assert.ok(esperaPendiente(u) > primera, 'el castigo tiene que crecer');
  });

  test('nunca pasa de 15 minutos', () => {
    const u = `tope-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 40; i++) apuntarFallo(u);
    assert.ok(esperaPendiente(u) <= 15 * 60_000, 'no puede dejar fuera media tarde');
  });

  test('entrar bien borra el historial', () => {
    const u = `ok-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 10; i++) apuntarFallo(u);
    assert.ok(esperaPendiente(u) > 0);
    olvidarFallos(u);
    assert.equal(esperaPendiente(u), 0);
  });

  test('EL CASO QUE ROMPIÓ LA OFICINA: frenar a uno no frena a los compañeros', () => {
    const atacado = `ana-${Math.round(process.hrtime()[1])}`;
    const companero = `beto-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 30; i++) apuntarFallo(atacado);

    assert.ok(esperaPendiente(atacado) > 0, 'la cuenta atacada sí se frena');
    assert.equal(
      esperaPendiente(companero),
      0,
      'el compañero de la MISMA oficina y la MISMA IP tiene que poder entrar',
    );
  });

  test('el nombre no distingue mayúsculas ni espacios', () => {
    const u = `Mixto-${Math.round(process.hrtime()[1])}`;

    for (let i = 0; i < 8; i++) apuntarFallo(u.toUpperCase());
    assert.ok(
      esperaPendiente(`  ${u.toLowerCase()}  `) > 0,
      'si no, basta con cambiar una mayúscula para saltarse el freno',
    );
  });

  test('un usuario que nunca falló no tiene espera', () => {
    assert.equal(esperaPendiente('nadie-lo-ha-intentado'), 0);
  });
});
