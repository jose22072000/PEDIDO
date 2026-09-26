import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Que el front escuche TODOS los eventos que el servidor emite.
 *
 * `EventSource` entrega por NOMBRE de evento: el servidor manda `event: webhook` y si
 * nadie registró un listener para «webhook», el mensaje llega al navegador y se
 * descarta. **No falla nada**: no hay error en consola, no hay 4xx, la conexión sigue
 * viva y el indicador sigue diciendo «En vivo». La pantalla simplemente no se entera
 * nunca, y desde fuera se ve igual que si no hubiera pasado nada.
 *
 * Pasó con TRES a la vez, y nadie lo vio hasta el 26/09/2026: `apikey`, `webhook` y
 * `tasa` se añadieron a `EntidadEvento` en el servidor y no a la lista del hook. Las
 * tres pantallas que los escuchaban —API keys, el webhook de domicilio y la tasa de la
 * lista de pedidos— llevaban desde entonces creyéndose en vivo sin estarlo.
 *
 * Por eso esto se prueba leyendo los DOS ficheros de verdad y no una copia: una copia
 * se queda vieja igual que se quedó la lista.
 */
const raiz = fileURLToPath(new URL('..', import.meta.url));

function tiposDelServidor(): string[] {
  const src = readFileSync(`${raiz}../api/src/lib/events.ts`, 'utf8');
  const bloque = src.slice(
    src.indexOf('export type EntidadEvento'),
    src.indexOf(';', src.indexOf('export type EntidadEvento')),
  );

  return [...bloque.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

function tiposQueEscuchaElFront(): string[] {
  const src = readFileSync(`${raiz}src/hooks/use-live-events.ts`, 'utf8');
  const bloque = src.slice(src.indexOf('const TODOS = ['), src.indexOf('];', src.indexOf('const TODOS = [')));

  return [...bloque.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

describe('los eventos que emite el servidor y los que escucha el front', () => {
  test('el front escucha TODOS los que el servidor emite', () => {
    const emite = tiposDelServidor();
    const escucha = new Set(tiposQueEscuchaElFront());
    const sordos = emite.filter((t) => !escucha.has(t));

    assert.deepEqual(
      sordos,
      [],
      `El servidor emite ${sordos.join(', ')} y el front no los escucha: llegan al ` +
        'navegador y se tiran sin que nada falle. Añádelos a TODOS en use-live-events.ts.',
    );
  });

  test('la lectura de los dos ficheros encuentra algo', () => {
    // Si un día se reescribe cualquiera de los dos y el regex deja de casar, esta
    // prueba pasaría vacía contra vacía y diría que todo está bien. Es el caso de
    // «prueba verde que no prueba», y por eso se comprueba aparte.
    assert.ok(tiposDelServidor().length >= 10, 'no se leyeron los tipos del servidor');
    assert.ok(tiposQueEscuchaElFront().length >= 10, 'no se leyó la lista del front');
  });

  test('«ready» es del front y no del servidor', () => {
    // El saludo de apertura lo manda el stream, no `emitEvent`. Está en la lista del
    // front a propósito y no tiene que estar en `EntidadEvento`.
    assert.ok(tiposQueEscuchaElFront().includes('ready'));
    assert.ok(!tiposDelServidor().includes('ready'));
  });

  test('el reparto está en las dos listas', () => {
    assert.ok(tiposDelServidor().includes('reparto'));
    assert.ok(tiposQueEscuchaElFront().includes('reparto'));
  });
});
