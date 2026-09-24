import prisma from '../prismaClient';
import { notifyPedidoCompletado } from './webhook';

export { FACTURADO, POR_LA_FACTURA, camposParaCompletar, conservaSuFactura } from './reglaFactura';

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
