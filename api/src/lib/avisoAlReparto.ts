/**
 * PEDIDO le avisa al REPARTO de lo que cambia, en vez de que el reparto pregunte.
 *
 * # Por qué
 *
 * El espejo del reparto preguntaba cada minuto, sucursal por sucursal, y además repasaba
 * siempre los últimos tres días «por si acaso». Medido el 26/09/2026 en el servidor:
 *
 *     customers      8.673 filas  ·  98.037.974 actualizaciones
 *     orders         5.414 filas  ·   7.125.767 actualizaciones
 *     order_items    7.450 filas  ·   8.892.252 insertados y 8.884.802 borrados
 *
 * Cada cliente reescrito once mil veces con lo mismo. Eso era el 36 % de CPU del
 * Postgres y el 23 % del propio espejo, con el servidor entero al 40 % sin que nadie
 * estuviera trabajando. Preguntar «¿ha cambiado algo?» sesenta veces por hora para que
 * la respuesta sea «no» es tirar la máquina a la basura.
 *
 * Ahora lo decimos nosotros, que somos los que lo sabemos.
 *
 * # Por qué una cola y no el canal que ya había
 *
 * `CH_EVENTS` es pub/sub y sirve para refrescar una pantalla abierta: si te pierdes un
 * aviso, el siguiente te pone al día. Para otro SISTEMA no vale — si el reparto está
 * reiniciándose justo cuando entra un pedido, ese pedido no le llega nunca y no hay
 * forma de notarlo. El stream guarda lo publicado hasta que alguien lo lee.
 *
 * # QUÉ se avisa, que no es todo
 *
 * Sólo lo que el reparto puede usar, y por eso el aviso sale de los cuatro sitios que
 * SABEN por qué, no de un enganche general que dispare con cualquier cambio:
 *
 *   factura      el cotejo encontró la factura, o la factura cambió
 *   domicilio    la APK puso el precio del domicilio: el pedido ya es repartible
 *   importacion  entró una tanda de CSV — mira esa sucursal entera
 *   borrado      se borró el pedido: hay que quitarlo del camión
 *
 * Un cambio de teléfono o de dirección no despierta a nadie: el reparto lo verá en su
 * ciclo lento. Llenar la cola de avisos que no llevan a ninguna acción es volver al
 * problema de origen, sólo que por el otro lado.
 *
 * # Lo que va en cada aviso, y lo que no
 *
 * Va el MÍNIMO para que el reparto sepa qué pedir: qué pedido, de qué sucursal y qué le
 * pasó. NO va el pedido entero. Dos motivos: un pedido con trescientas líneas por cada
 * cambio satura los enlaces de las sucursales, y sobre todo, el que manda es el estado
 * de la base cuando el reparto lo lea, no la foto de hace diez minutos. El reparto pide
 * lo que necesite por donde ya lo pide hoy.
 *
 * # Y si el aviso se pierde igual
 *
 * El reparto mantiene su ciclo completo, pero LENTO (cada quince o treinta minutos en
 * vez de cada uno). Es la red debajo del trapecio: con avisos, casi nunca encuentra
 * nada; sin ellos, el espejo sigue funcionando como hasta hoy, sólo que más despacio.
 */
import { xaddReparto, STREAM_REPARTO } from './redis';

/** Lo que el reparto necesita saber de un cambio. Todo texto: un stream es campo/valor. */
export interface AvisoReparto {
  /** `pedido`. Se manda para que el consumidor pueda distinguir si mañana hay más. */
  entidad: string;
  /**
   * POR QUÉ se avisa. Es lo que le dice al reparto qué hacer sin tener que adivinarlo:
   *
   *   factura      apareció la factura, o cambió — el pedido ya se puede cargar
   *   domicilio    le pusieron el precio del domicilio: es repartible
   *   importacion  entró una tanda de CSV: mira esa sucursal entera
   *   borrado      se borró: quítalo del camión
   */
  motivo: string;
  /** Qué le pasó, con las palabras de PEDIDO: `update`, `delete`, `igual`, `cambiado`… */
  accion: string;
  /** El id del pedido. Vacío en los avisos de tanda, que son «mira la sucursal». */
  id: string;
  /** De qué sucursal. Vacío = no se sabe, y entonces el reparto mira todas. */
  sucursalId: string;
  /** Cuándo, en milisegundos. Sirve para medir el retraso de punta a punta. */
  ts: string;
}

export interface CambioParaElReparto {
  id?: string | null;
  sucursalId?: string | null;
  motivo: 'factura' | 'domicilio' | 'importacion' | 'borrado';
  accion?: string;
}

/**
 * Arma el aviso. Puro y aparte para poder probarlo: lo que se manda importa tanto como
 * que se mande, y un campo con `undefined` dentro rompe el `XADD` entero.
 */
export function armarAviso(c: CambioParaElReparto, ahora: () => number = Date.now): AvisoReparto {
  return {
    entidad: 'pedido',
    motivo: c.motivo,
    accion: c.accion || 'change',
    // Nunca `undefined` ni `null`: Redis los rechaza y el aviso se perdería entero.
    id: c.id ?? '',
    sucursalId: c.sucursalId ?? '',
    ts: String(ahora()),
  };
}

/**
 * ¿Está encendido el aviso?
 *
 * `DELIVERY_EVENTS` ya existía en el `.env` desde que esto se planeó, puesta a `true` y
 * sin que la leyera nadie. Ahora significa lo que decía que significaba. Apagada, PEDIDO
 * se comporta exactamente como antes.
 */
export function avisosEncendidos(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.DELIVERY_EVENTS || '').trim().toLowerCase() === 'true';
}

/** Deja el aviso en la bandeja del reparto. Best-effort: nunca lanza, nunca bloquea. */
export function avisarAlReparto(cambio: CambioParaElReparto): void {
  if (!avisosEncendidos()) return;

  void xaddReparto(armarAviso(cambio) as unknown as Record<string, string>);
}

export { STREAM_REPARTO };
