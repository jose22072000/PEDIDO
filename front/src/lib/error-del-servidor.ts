/**
 * Lo que el servidor dice que pasó, en vez de un texto genérico.
 *
 * Esto existe por un fallo que costó horas. La pantalla de pedidos hacía:
 *
 *     if (!response.ok) throw new Error("Error al completar el pedido");
 *
 * y tiraba a la basura el mensaje del servidor. Daba igual que la respuesta
 * fuera "tu sesión caducó", "ese pedido es de otra sucursal" o "no tienes
 * permiso": la operadora veía siempre lo mismo. Nadie —tampoco quien revisaba
 * el servidor— podía saber qué había pasado, porque los 4xx ni siquiera se
 * registran. El 07/08/2026 dos operadoras estuvieron sin poder completar
 * pedidos y el único dato disponible era esa frase.
 *
 * La regla: **el usuario tiene derecho a saber QUÉ falló.** Un mensaje del
 * servidor está escrito para él; uno genérico solo sirve para que parezca que
 * la aplicación está rota.
 */
export async function mensajeDeError(
  respuesta: Response,
  porDefecto: string,
): Promise<string> {
  try {
    const json = await respuesta.clone().json();
    const dice = json?.error || json?.message;

    if (typeof dice === 'string' && dice.trim()) return dice;
  } catch {
    /* la respuesta no era JSON: se usa el texto de abajo */
  }

  // Sin mensaje del servidor, al menos se dice algo útil según el código.
  if (respuesta.status === 401) return 'Tu sesión caducó. Vuelve a entrar.';
  if (respuesta.status === 403) return 'No tienes permiso para hacer esto.';
  if (respuesta.status === 404) return 'No se encontró. Puede que ya no exista o sea de otra sucursal.';
  if (respuesta.status >= 500) return 'El servidor tuvo un problema. Inténtalo de nuevo.';

  return porDefecto;
}
