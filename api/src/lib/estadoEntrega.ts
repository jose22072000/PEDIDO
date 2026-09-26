/**
 * En qué va cada entrega: lo que el REPARTO nos escribe de vuelta.
 *
 * Vive aquí y no en una ruta porque entra por dos puertas distintas y tiene que hacer
 * exactamente lo mismo en las dos:
 *
 *   /integration/orders/status   la puerta vieja, con la clave de servicio. La usa la
 *                                delivery de siempre y no se toca.
 *   /webhooks/reparto/estados    la de delivery-logistica: misma clave y ADEMÁS firmada,
 *                                que es lo que hace falta en una puerta que escribe.
 *
 * Con la lógica copiada en las dos, el día que se añada un estado se añade en una y la
 * otra empieza a rechazarlo sin que nadie lo note hasta que un camión ya salió.
 */
import prisma from '../prismaClient';
import { emitEvent } from './events';
import { readConfiguredSucursalId } from './sucursalLocal';

/**
 * Los cinco. `devuelto` y `cancelado` NO tocan el inventario: el reintegro lo hace
 * Ventra y la cuenta de lo que baja del camión la lleva el logístico.
 */
export const ESTADOS_ENTREGA = new Set(['despachado', 'en_transito', 'entregado', 'devuelto', 'cancelado']);

export const TOPE_POR_LLAMADA = 500;

export interface EstadoQueLlega {
  pedidoId?: string;
  estado?: string;
  nota?: string;
  at?: string;
}

export interface ResultadoEstados {
  ok: boolean;
  recibidos: number;
  aplicados: Array<{ pedidoId: string; folio: string; estado: string }>;
  rechazados: Array<{ pedidoId?: string; motivo: string }>;
}

/**
 * Aplica los estados que vengan. En LOTE y por separado: que un pedido venga mal no es
 * razón para descartar los otros cuarenta que venían bien, y quien llama necesita saber
 * cuál de los suyos no entró y por qué, no un «falló» sobre el lote entero.
 *
 * `pedidoParaLista` se pasa desde fuera para no arrastrar aquí media ruta de pedidos.
 */
export async function aplicarEstadosDeEntrega(
  pedidos: EstadoQueLlega[],
  pedidoParaLista: (id: string) => Promise<unknown>,
): Promise<ResultadoEstados> {
  const local = readConfiguredSucursalId();
  const alcance = local ? { sucursalId: local } : {};
  const aplicados: ResultadoEstados['aplicados'] = [];
  const rechazados: ResultadoEstados['rechazados'] = [];
  const tocados: Array<{ id: string; sucursalId: string | null }> = [];

  for (const e of pedidos) {
    if (!e || typeof e !== 'object') {
      rechazados.push({ motivo: 'entrada no es un objeto' });
      continue;
    }

    const estado = typeof e.estado === 'string' ? e.estado.trim() : '';

    if (!ESTADOS_ENTREGA.has(estado)) {
      rechazados.push({
        pedidoId: e.pedidoId,
        motivo: `estado '${estado}' desconocido (${[...ESTADOS_ENTREGA].join(' | ')})`,
      });
      continue;
    }

    try {
      const pedido = await prisma.pedido.findFirst({
        where: { id: String(e.pedidoId || ''), ...alcance },
        select: { id: true, folio: true, sucursalId: true, estadoEntrega: true, estadoEntregaNota: true },
      });

      if (!pedido) {
        rechazados.push({ pedidoId: e.pedidoId, motivo: 'no existe aquí (¿otra sucursal?)' });
        continue;
      }

      const nota = e.nota ? String(e.nota).slice(0, 500) : null;

      // Sólo si cambió: `updatedAt` es la marca de agua con la que sincronizan las tablets.
      if (pedido.estadoEntrega !== estado || pedido.estadoEntregaNota !== nota) {
        await prisma.pedido.update({
          where: { id: pedido.id },
          data: {
            estadoEntrega: estado,
            estadoEntregaAt: e.at ? new Date(e.at) : new Date(),
            estadoEntregaNota: nota,
          },
        });
        tocados.push({ id: pedido.id, sucursalId: pedido.sucursalId });
      }

      aplicados.push({ pedidoId: pedido.id, folio: pedido.folio, estado });
    } catch (err) {
      rechazados.push({ pedidoId: e.pedidoId, motivo: (err as Error).message });
    }
  }

  for (const t of tocados) {
    emitEvent('pedido', { id: t.id, sucursalId: t.sucursalId, accion: 'update', datos: await pedidoParaLista(t.id) });
    /*
     * Y aquí NO se le avisa al reparto, a propósito.
     *
     * Esto es lo que el reparto acaba de decirnos. Avisarle de vuelta es contarle lo que
     * él mismo escribió: un eco. Su aviso le haría pedir el pedido, pedirlo no cambia
     * nada, y lo único que queda es tráfico dando vueltas entre los dos sistemas.
     */
  }

  /*
   * Pero a la PANTALLA sí. Esto no es un eco: la sincronización enseña «recibidos hoy»
   * y el último que entró, y esos dos números sólo se mueven aquí.
   *
   * Va UNA vez por lote y no una por pedido: un lote de quinientos son quinientos
   * eventos por un contador que se lee de una sola consulta, y con la red de las
   * sucursales eso es justo lo que no se puede mandar.
   */
  if (tocados.length) emitEvent('reparto', { accion: 'entrada' });

  return { ok: rechazados.length === 0, recibidos: pedidos.length, aplicados, rechazados };
}

/** Saca la lista de estados de las tres formas en que la mandan. */
export function comoVengan(cuerpo: any): EstadoQueLlega[] {
  if (Array.isArray(cuerpo?.pedidos)) return cuerpo.pedidos;
  if (Array.isArray(cuerpo)) return cuerpo;
  if (cuerpo?.estado) return [cuerpo];

  return [];
}
