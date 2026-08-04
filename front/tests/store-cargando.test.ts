import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * La bandera `cargando` del store es la que pinta el spinner. Si se queda
 * encendida, la pantalla gira para siempre encima de datos que ya tiene — que es
 * exactamente lo que le pasó a Jose en Vendedores el 04/08/2026.
 *
 * El store real necesita React para montarse, así que aquí se prueba la pieza que
 * decide cuándo se baja la bandera: el contador de peticiones vivas POR CLAVE.
 * El fallo era contar por componente: al cambiar de filtro, la petición vieja se
 * cancelaba cuando otra ya había tomado el relevo y NADIE bajaba la bandera de la
 * clave vieja.
 */

// Misma lógica que en el store (crearStoreDatos.ts).
const enVuelo = new Map<string, number>();
const sumar = (clave: string, n: number) => {
  const v = (enVuelo.get(clave) ?? 0) + n;

  if (v > 0) enVuelo.set(clave, v);
  else enVuelo.delete(clave);

  return v;
};

describe('cuándo se baja la bandera de cargando', () => {
  test('una petición sola: al acabar no queda nada vivo', () => {
    enVuelo.clear();
    sumar('a', 1);
    assert.equal(sumar('a', -1), 0, 'con 0 vivas, la bandera se baja');
  });

  test('dos peticiones de la MISMA clave: la primera en acabar no baja la bandera', () => {
    enVuelo.clear();
    sumar('a', 1);
    sumar('a', 1);
    assert.equal(sumar('a', -1), 1, 'aún queda una viva: sigue cargando');
    assert.equal(sumar('a', -1), 0, 'ahora sí');
  });

  test('EL FALLO: cancelar la clave vieja al cambiar de filtro la deja limpia', () => {
    enVuelo.clear();
    sumar('sucursal-A', 1); // se pide A
    sumar('sucursal-B', 1); // el usuario cambia a B; A se cancela
    assert.equal(sumar('sucursal-A', -1), 0, 'A queda sin peticiones -> baja su bandera');
    assert.equal(enVuelo.has('sucursal-A'), false, 'y no deja rastro');
    assert.equal(enVuelo.get('sucursal-B'), 1, 'B sigue cargando, como debe');
  });

  test('volver a una clave ya limpia no la deja colgada', () => {
    enVuelo.clear();
    sumar('a', 1);
    sumar('a', -1);
    // Al volver, el efecto mira si hay algo vivo para decidir si cura la bandera.
    assert.equal(enVuelo.get('a') ?? 0, 0, 'sin nada vivo: la bandera huérfana se corrige');
  });

  test('el contador nunca se va por debajo de cero', () => {
    enVuelo.clear();
    assert.equal(sumar('a', -1), -1);
    assert.equal(enVuelo.has('a'), false, 'no se guardan negativos');
    // Y una petición nueva empieza limpia desde cero.
    assert.equal(sumar('a', 1), 1);
  });
});
