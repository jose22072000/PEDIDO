/**
 * La sucursal en la que el usuario está "enfocado", leída de UN solo sitio.
 *
 * El Super Admin es global y no tiene sucursal propia: por defecto ve todas, y
 * con el selector puede concentrarse en una. Esa elección se guarda aquí y el
 * envoltorio de `fetch` la manda en la cabecera `x-sucursal-id`.
 *
 * **Por qué está en su propio módulo.** El valor `__todas__` NO es el id de una
 * sucursal: es lo que vale la opción "Todas" del desplegable. Había DOS sitios
 * leyendo esta misma clave con reglas distintas — el selector la limpiaba, y el
 * envoltorio de `fetch` la leía en crudo. Resultado: un navegador que alguna vez
 * eligió "Todas" seguía mandando `x-sucursal-id: __todas__` para siempre.
 *
 * Para un Super Admin eso significa "todas" y funciona. Para cualquier otro no
 * es una sucursal válida y el servidor responde **400 a todo**: pedidos,
 * vendedores, clientes, el canal de eventos. Le pasó a una operadora el
 * 06/08/2026 en el navegador donde antes se había entrado como admin — la
 * pantalla entera en cero y "Error al cargar los pedidos", mientras que a los
 * demás les funcionaba.
 *
 * Que un valor viejo guardado en el navegador tumbe la aplicación de otro
 * usuario es lo que pasa cuando la misma clave se lee con dos reglas. Ahora hay
 * una.
 */
export const SUCURSAL_ACTIVA_KEY = "sucursal_activa";

/** Valor del desplegable para "todas las sucursales". No es un id. */
export const TODAS = "__todas__";

/**
 * Devuelve el id de la sucursal enfocada, o null si no hay ninguna (o si lo
 * guardado no es un id de verdad).
 *
 * Cuando encuentra el valor "todas" lo BORRA: así los navegadores que lo
 * arrastran desde antes se arreglan solos la primera vez que se lee, sin que
 * nadie tenga que limpiar nada a mano.
 */
export function getSucursalActiva(): string | null {
  if (typeof window === "undefined") return null;

  let guardado: string | null = null;

  try {
    guardado = localStorage.getItem(SUCURSAL_ACTIVA_KEY);
  } catch {
    return null; // navegador sin almacenamiento (modo privado estricto)
  }

  if (!guardado || guardado === TODAS) {
    if (guardado) {
      try {
        localStorage.removeItem(SUCURSAL_ACTIVA_KEY);
      } catch {
        /* no se pudo limpiar: se devuelve null igual */
      }
    }

    return null;
  }

  return guardado;
}
