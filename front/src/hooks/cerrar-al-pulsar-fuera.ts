import { useEffect, useRef } from "react";

/**
 * Cierra un modal al pulsar FUERA, sin que un desplegable cuente como "fuera".
 *
 * HeroUI trae `isDismissable`, pero aquí no sirve: los desplegables (el `Select`
 * de Rol, el de Sucursal, el de año...) NO se dibujan dentro del modal — se
 * dibujan aparte, al final de la página. Para la comprobación de la librería,
 * elegir una opción es un clic fuera del modal, así que **cerraba el modal
 * entero en mitad de la edición** y se perdía lo tecleado. Se vio nada más
 * activarlo: abrir "Editar usuario", desplegar Rol, elegir uno, y el modal se
 * cerraba solo.
 *
 * La regla de aquí es la que no se puede confundir. HeroUI envuelve el modal en
 * un marco que ocupa toda la pantalla y lleva `data-slot="wrapper"`; el modal va
 * dentro de él. Entonces:
 *
 *   - el clic no cae en ese marco  -> no es asunto de este modal (no se cierra)
 *   - cae en el marco pero dentro del modal -> se está usando el modal
 *   - cae en el marco y fuera del modal -> ESO es pulsar fuera: se cierra
 *
 * Un desplegable se dibuja FUERA del marco (y por encima), así que no entra por
 * ninguna de las tres. Los `role="listbox"`/`menu` se descartan igual por si una
 * versión futura los pusiera dentro.
 *
 * Se escucha `mousedown` y no `click`: un `click` solo cuenta si se suelta sobre
 * el mismo elemento donde se pulsó, así que arrastrar para seleccionar texto
 * dentro del modal y soltar fuera no cierra nada — con `click` tampoco cerraría,
 * pero con `mousedown` la respuesta es inmediata, que es como se siente bien.
 */
export function useCerrarAlPulsarFuera(
  estaAbierto: boolean,
  cerrar: () => void,
) {
  // `cerrar` suele venir como una flecha escrita en el sitio de la llamada, o
  // sea una funcion NUEVA en cada render. Si estuviera en las dependencias del
  // efecto, el listener se quitaria y se volveria a poner en cada repintado. Se
  // guarda en una referencia: el efecto depende solo de si el modal esta
  // abierto, y aun asi siempre llama a la version mas reciente.
  const alCerrar = useRef(cerrar);

  alCerrar.current = cerrar;

  useEffect(() => {
    if (!estaAbierto) return;

    const alPulsar = (e: MouseEvent) => {
      const destino = e.target as HTMLElement | null;

      if (!destino || !destino.closest) return;

      // Fuera del marco del modal: o es otro modal, o es un desplegable, o es
      // un aviso flotante. No es "pulsar fuera de ESTE modal".
      if (!destino.closest('[data-slot="wrapper"]')) return;

      // Dentro del modal: se está usando.
      if (destino.closest('[role="dialog"]')) return;

      // Un desplegable abierto dentro del marco tampoco cuenta.
      if (destino.closest('[role="listbox"],[role="menu"],[role="option"]')) return;

      alCerrar.current();
    };

    document.addEventListener("mousedown", alPulsar);

    return () => document.removeEventListener("mousedown", alPulsar);
  }, [estaAbierto]);
}
