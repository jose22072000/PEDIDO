/**
 * LAS REGLAS DE LA FACTURA, SIN BASE DE DATOS.
 *
 * Están aparte para poder probarlas. Vivían junto a `avisarCompletadoAutomatico`, que
 * abre Prisma nada más importarse, así que una prueba de estas cuatro líneas levantaba
 * una conexión a Postgres y se caía sola. Una regla que no se puede probar es una regla
 * que nadie comprueba.
 */
/**
 * Un pedido con factura está completado. Punto.
 *
 * # Por qué existe
 *
 * «Completar» significa «esto ya se facturó». Cuando la factura aparece en Ventra, el
 * sistema YA LO SABE — y sin embargo alguien tenía que ir a pulsar el botón pedido por
 * pedido. Lo que se marca a mano se marca tarde o no se marca: de ahí salían los
 * completados sin factura que hubo que perseguir, y los facturados que seguían contando
 * como «en proceso» días después.
 *
 * # Qué se completa
 *
 * Los que tienen factura, `igual` o `cambiado`. **También los cambiados**: que se
 * facturara distinto de lo que se pidió no lo deja a medias — se facturó, y lo que se
 * reparte es lo facturado. La diferencia sigue estando a la vista en su propio estado de
 * factura, que es donde se mira.
 *
 * **Y también los expirados.** Un pedido expirado es uno cuya fecha comprometida pasó, y
 * eso no es un estado guardado sino una cuenta sobre la fecha. Si llegó a facturarse, lo
 * que pasó de verdad es que se entregó tarde, no que se quedó sin hacer.
 *
 * # Quién lo completó
 *
 * `completadoPor` se inventó para poder preguntarle a alguien por un pedido completado sin
 * factura. Si el sistema completa y no lo dice, mañana no se distingue lo que marcó una
 * persona de lo que se marcó solo — y esa columna deja de servir justo para lo que se
 * hizo. Por eso queda escrito, y sin `completadoPorId`: no hay usuario detrás.
 *
 * # Una sola función
 *
 * La factura se escribe desde DOS sitios —el cotejo contra Ventra y el endpoint que usa
 * delivery—. Con la regla copiada en los dos, el día que alguien tocara uno los pedidos se
 * completarían según por dónde hubiera entrado la factura.
 */
export const FACTURADO = new Set(['igual', 'cambiado']);

/** La marca que queda en `completadoPor` cuando no hay persona detrás. */
export const POR_LA_FACTURA = 'automático · factura';

/**
 * ¿Esta pasada tiene derecho a quitarle la factura a un pedido que ya la tenía?
 *
 * Pasar de `igual`/`cambiado` a `sin_factura` es afirmar «esa factura ya no está», y eso
 * sólo se puede decir si se miró donde tocaba: la consulta a Ventra tiene que cubrir el
 * día de ESE pedido. El carril rápido pregunta sólo por lo facturado HOY, así que de un
 * pedido de anteayer no sabe nada — y sin esta guarda le borraba la factura buena.
 *
 * Pasó de verdad: 113 pedidos del 21 al 23/09/2026 quedaron completados «por la factura»
 * y diciendo «no apareció» al mismo tiempo. Dos cosas que no pueden ser ciertas a la vez,
 * y la pantalla las enseñaba juntas.
 *
 * Devuelve `true` cuando hay que dejar el pedido EXACTAMENTE como estaba.
 */
export function conservaSuFactura(
  estadoGuardado: string | null | undefined,
  estadoNuevo: string | null | undefined,
  puedeDescasar: boolean,
): boolean {
  if (puedeDescasar) return false;
  if (estadoNuevo !== 'sin_factura') return false;

  return FACTURADO.has(estadoGuardado ?? '');
}

/**
 * Los campos que hay que añadir para completarlo, o `null` si no toca.
 *
 * No toca cuando no hay factura, o cuando ya estaba completado — repetirlo movería el
 * `completedAt` a hoy y borraría de la vista quién y cuándo lo completó de verdad.
 */
export function camposParaCompletar(
  estadoFactura: string | null | undefined,
  estadoPedido: string | null | undefined,
): Record<string, unknown> | null {
  if (!estadoFactura || !FACTURADO.has(estadoFactura)) return null;
  if (estadoPedido === 'completada') return null;

  return {
    estado: 'completada',
    completedAt: new Date(),
    completadoPor: POR_LA_FACTURA,
    completadoPorId: null,
  };
}

