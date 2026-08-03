import type { LiveEvent } from "./use-live-events";

/**
 * Aplica una ráfaga de eventos SSE sobre la lista que la vista YA tiene pintada.
 *
 * Antes cada evento disparaba un `fetch` de la lista entera: la vista se ponía en
 * "cargando", pintaba el esqueleto y volvía a dibujar. Eso es el parpadeo que se
 * veía cada pocos segundos. Como el evento ahora trae la entidad completa, aquí se
 * mete/sustituye/quita en memoria y no se toca el servidor.
 *
 * Devuelve `null` cuando NO se puede aplicar (un evento sin objeto: importación
 * masiva, backfill, objeto demasiado grande). En ese caso la vista sí tiene que
 * recargar, pero de fondo: sin esqueleto y sin borrar lo que ya se ve.
 *
 * @param filtrar  decide si la entidad sigue perteneciendo a esta vista con los
 *                 filtros actuales. Si devuelve false, se quita de la lista: es lo
 *                 que hace que un vendedor que cambia de sucursal desaparezca de la
 *                 sucursal que lo pierde sin necesidad de recargar.
 */
export function aplicarLote<T extends { id: string }>(
  lista: T[],
  lote: LiveEvent[],
  opts: { filtrar?: (item: T) => boolean; alPrincipio?: boolean } = {},
): T[] | null {
  const { filtrar, alPrincipio = false } = opts;
  let salida = lista;
  let cambio = false;

  for (const ev of lote) {
    if (ev.accion === "delete") {
      if (!ev.id) return null;
      const sinEl = salida.filter((x) => x.id !== ev.id);

      if (sinEl.length !== salida.length) {
        salida = sinEl;
        cambio = true;
      }
      continue;
    }

    // Sin objeto no hay nada que aplicar: la vista tiene que refrescar.
    if (ev.datos == null || typeof ev.datos !== "object") return null;

    const entidad = ev.datos as T;

    if (!entidad.id) return null;

    const i = salida.findIndex((x) => x.id === entidad.id);
    const encaja = filtrar ? filtrar(entidad) : true;

    if (!encaja) {
      // Dejó de cumplir los filtros de esta vista (cambió de sucursal, de estado…).
      if (i >= 0) {
        salida = salida.filter((x) => x.id !== entidad.id);
        cambio = true;
      }
      continue;
    }

    if (i >= 0) {
      salida = salida.map((x, j) => (j === i ? entidad : x));
    } else {
      // Uno nuevo. Solo se inserta si la vista lo pide: en una lista paginada y
      // ordenada, meter un elemento a mano descuadra la paginación, así que esas
      // vistas prefieren avisar ("hay N nuevos") a mentir sobre lo que enseñan.
      if (!alPrincipio) continue;
      salida = [entidad, ...salida];
    }
    cambio = true;
  }

  return cambio ? salida : lista;
}
