/**
 * ¿Es una fecha que el servidor va a poder leer? (AAAA-MM-DD)
 *
 * El campo de fecha del navegador deja teclear un año de MÁS de cuatro cifras.
 * Mientras se escribe puede valer "202026-08-06", que no es una fecha ISO: el
 * servidor no la podía convertir y devolvía un 500 que dejaba la lista en
 * blanco (pasó el 06/08/2026, tres veces seguidas).
 *
 * El servidor ya lo rechaza con un mensaje claro. Esto es la otra mitad: no
 * mandarla siquiera, para que escribir la fecha no dé un error por cada tecla.
 */
export function esFechaEnviable(valor: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((valor ?? "").trim());
}
