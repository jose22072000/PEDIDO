/**
 * El "_" de un nombre de usuario es un ESPACIO.
 *
 * Por dentro los nombres se guardan como una sola palabra —"liannet_rodriguez"—
 * porque un espacio de verdad no se ve al final de la cadena, se pierde al copiar
 * y pegar, y dos espacios seguidos son indistinguibles de uno. Guardar y mostrar
 * son cosas distintas: a la vista tiene que leerse como un nombre.
 *
 * El servidor hace la conversión al revés al crear y al entrar (api/src/lib/
 * nombreUsuario.ts), así que quien teclee el espacio entra igual.
 */
export function mostrarUsuario(username: string | null | undefined): string {
  return (username ?? "").replace(/_/g, " ");
}
