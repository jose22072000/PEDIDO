/**
 * Combina la señal de cancelación de quien llama con un tope de tiempo.
 *
 * `fetch` no tiene timeout propio. En un enlace malo (Starlink, una sucursal con
 * la antena tapada) una petición puede quedarse colgada minutos: el TCP no muere
 * y la promesa nunca se resuelve. En pantalla eso es un spinner que no termina
 * nunca, que es peor que un error — con un error al menos se sabe que hay que
 * reintentar.
 *
 * El envoltorio de `fetch` ya ponía ese tope, pero se lo saltaba cuando la
 * petición traía su propia `signal`. Como los stores de datos SIEMPRE pasan una
 * (para poder cancelar al cambiar de filtro), todas las vistas que usan store se
 * quedaron sin red de seguridad. De ahí que aquí se COMBINEN en vez de elegir:
 * cancelar desde fuera sigue funcionando igual, y además hay tope.
 *
 * El motivo del aborto se propaga tal cual, porque quien lo recibe necesita
 * distinguir "lo cancelé yo" (cambié de filtro: no es un error, no se pinta
 * nada) de "se acabó el tiempo" (sí es un error y hay que decirlo).
 */
export function senalConTope(
  externa: AbortSignal | null | undefined,
  ms: number,
): { signal: AbortSignal; limpiar: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("La petición tardó demasiado", "TimeoutError")),
    ms,
  );

  if (externa) {
    // Si ya venía cancelada, no se espera al siguiente ciclo: se aborta ya, o se
    // dispararía una petición que nadie va a leer.
    if (externa.aborted) ctrl.abort(externa.reason);
    else
      externa.addEventListener("abort", () => ctrl.abort(externa.reason), {
        once: true,
      });
  }

  return { signal: ctrl.signal, limpiar: () => clearTimeout(timer) };
}

/** ¿Este fallo es "se acabó el tiempo" y no "lo cancelé yo"? */
export function esTiempoAgotado(e: unknown): boolean {
  return e instanceof DOMException && e.name === "TimeoutError";
}
