import prisma from '../prismaClient';
import { notifyPedidoCompletado } from './webhook';

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

/**
 * Avisa a Parranda de un pedido que se completó solo.
 *
 * El camino a mano ya lo hace, y si aquí no se hiciera, Parranda se quedaría sin enterarse
 * de todo lo que pase a completarse por la factura — que va a ser la mayoría. Es «lo mejor
 * que se pueda»: si falla, el pedido ya está completado y eso es lo que importa.
 */
export async function avisarCompletadoAutomatico(pedidoId: string): Promise<void> {
  try {
    const p = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        folio: true, completedAt: true, fecha: true, estado: true,
        cliente: { select: { codigo: true, nombre: true } },
        sucursal: { select: { codigo: true } },
        items: { select: { producto: true, unidades: true, packs: true } },
      },
    });

    if (p) notifyPedidoCompletado(p);
  } catch (e) {
    console.error('[autocompletado] no se pudo avisar a Parranda:', (e as Error).message);
  }
}
