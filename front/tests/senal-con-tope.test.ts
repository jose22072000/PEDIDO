import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { esTiempoAgotado, senalConTope } from '../src/lib/senal-con-tope.ts';

/**
 * Esto es lo que impide que una pantalla se quede girando para siempre.
 *
 * El fallo real: el envoltorio de `fetch` ponía un tope de 25 s, pero se lo
 * saltaba si la petición ya traía `signal`. Los stores de datos SIEMPRE pasan
 * una, así que todas las vistas migradas se quedaron sin tope y con la red mala
 * el spinner no terminaba nunca. El caso que lo cubre es
 * `sigue_habiendo_tope_aunque_venga_una_senal_de_fuera`: si esa prueba se cae,
 * vuelve el spinner infinito.
 */

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('senalConTope', () => {
  test('aborta al pasarse el tiempo cuando no hay señal de fuera', async () => {
    const { signal, limpiar } = senalConTope(null, 20);

    assert.equal(signal.aborted, false);
    await esperar(45);
    assert.equal(signal.aborted, true);
    assert.ok(esTiempoAgotado(signal.reason), 'el motivo debe ser tiempo agotado');
    limpiar();
  });

  test('sigue habiendo tope aunque venga una señal de fuera', async () => {
    // EL CASO DEL FALLO: antes esto se devolvía sin tope y colgaba para siempre.
    const fuera = new AbortController();
    const { signal, limpiar } = senalConTope(fuera.signal, 20);

    assert.equal(signal.aborted, false);
    await esperar(45);
    assert.equal(signal.aborted, true, 'sin esto, la pantalla gira sin fin');
    assert.ok(esTiempoAgotado(signal.reason));
    limpiar();
  });

  test('cancelar desde fuera sigue funcionando y llega su motivo', () => {
    const fuera = new AbortController();
    const { signal, limpiar } = senalConTope(fuera.signal, 10_000);

    fuera.abort(new DOMException('cambié de filtro', 'AbortError'));

    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as DOMException).name, 'AbortError');
    assert.equal(esTiempoAgotado(signal.reason), false, 'no es tiempo agotado: no debe pintar error');
    limpiar();
  });

  test('si la señal de fuera ya venía cancelada, no se lanza la petición', () => {
    const fuera = new AbortController();

    fuera.abort(new DOMException('ya no hace falta', 'AbortError'));

    const { signal, limpiar } = senalConTope(fuera.signal, 10_000);

    assert.equal(signal.aborted, true);
    limpiar();
  });

  test('limpiar() evita que salte el tope de una petición ya terminada', async () => {
    const { signal, limpiar } = senalConTope(null, 20);

    limpiar();
    await esperar(45);
    assert.equal(signal.aborted, false, 'una petición ya resuelta no debe abortarse después');
  });
});
