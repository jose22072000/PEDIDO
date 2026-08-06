import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { esPulsacionFuera } from "../src/hooks/cerrar-al-pulsar-fuera.ts";

/**
 * Cerrar el modal al pulsar fuera es fácil de pedir y fácil de romper.
 *
 * El 06/08/2026 se activó con el `isDismissable` de HeroUI y salió mal: los
 * desplegables (Rol, Sucursal, año) NO se dibujan dentro del modal, así que
 * elegir una opción contaba como "clic fuera" y el modal se cerraba EN MITAD de
 * la edición, perdiendo lo tecleado. La queja fue literal: "señalo y se cierra
 * el modal".
 *
 * Estas pruebas fijan la regla. Si alguna cae, o el modal no se cierra nunca, o
 * se cierra cuando no debe — y lo segundo hace perder trabajo.
 */

/** Finge un elemento del DOM: solo hace falta saber qué antepasados tiene. */
function elemento(...antepasados: string[]) {
  return {
    closest: (selector: string) =>
      selector
        .split(",")
        .map((s) => s.trim())
        .some((s) => antepasados.includes(s))
        ? {}
        : null,
  };
}

const MARCO = '[data-slot="wrapper"]';
const MODAL = '[role="dialog"]';

describe("¿es pulsar fuera del modal?", () => {
  test("SÍ: el clic cae en el marco, fuera del modal", () => {
    assert.equal(esPulsacionFuera(elemento(MARCO)), true);
  });

  test("NO: el clic cae dentro del modal", () => {
    assert.equal(esPulsacionFuera(elemento(MARCO, MODAL)), false);
  });

  test("EL FALLO REAL: elegir en un desplegable NO cierra el modal", () => {
    // El desplegable se dibuja FUERA del marco (portal al final de la página).
    // Este es el caso que cerraba el modal en mitad de editar un usuario.
    assert.equal(esPulsacionFuera(elemento('[role="listbox"]')), false);
    assert.equal(esPulsacionFuera(elemento('[role="option"]')), false);
  });

  test("y tampoco si el desplegable se dibujara DENTRO del marco", () => {
    // Por si una versión futura de la librería cambia dónde lo pone.
    assert.equal(esPulsacionFuera(elemento(MARCO, '[role="listbox"]')), false);
    assert.equal(esPulsacionFuera(elemento(MARCO, '[role="option"]')), false);
    assert.equal(esPulsacionFuera(elemento(MARCO, '[role="menu"]')), false);
  });

  test("NO: un clic en cualquier otro sitio de la página", () => {
    // Un aviso flotante, la barra de navegación, otro modal... nada de eso es
    // "pulsar fuera de ESTE modal".
    assert.equal(esPulsacionFuera(elemento()), false);
    assert.equal(esPulsacionFuera(elemento('[data-slot="content"]')), false);
  });

  test("sin elemento, o sin closest, no pasa nada", () => {
    assert.equal(esPulsacionFuera(null), false);
    assert.equal(esPulsacionFuera({} as never), false);
  });
});
