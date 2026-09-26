/**
 * PEDIDO le avisa al REPARTO de los pedidos que le tocan, en vez de que el reparto
 * pregunte.
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
 * # QUÉ se avisa, que no es todo ni de lejos
 *
 * SÓLO los pedidos que el reparto va a llevar: **van a domicilio y ya tienen factura**.
 * Las dos condiciones a la vez, y por eso están en un solo sitio —`esParaElReparto`— y
 * no repartidas por los sitios que avisan: la regla es una y tiene que poder cambiarse
 * en un sitio.
 *
 *   a domicilio   `requiere_domicilio`, o la factura trae la línea de ENTREGA A
 *                 DOMICILIO (`facturaDomicilio`), que es la señal más fiable porque
 *                 sale de lo que se cobró y no de una casilla que alguien marcó.
 *   con factura   tiene número de factura, o el cotejo ya dijo `igual` / `cambiado`.
 *
 * Un pedido de mostrador no le sirve al reparto para nada, y uno sin facturar tampoco:
 * no se puede cargar en un camión lo que todavía no se sabe qué es. El primer día en
 * producción salieron veinticinco avisos y los veinticinco eran ruido —tandas de CSV
 * enteras, sin sucursal siquiera—: eso es el barrido que veníamos a quitar, disfrazado.
 *
 * Los motivos siguen siendo los cuatro, porque le dicen al reparto QUÉ hacer:
 *
 *   factura      el cotejo encontró la factura, o la factura cambió
 *   domicilio    la APK puso el precio del domicilio
 *   importacion  entró una tanda de CSV con pedidos que ya le tocan
 *   borrado      se borró el pedido: hay que quitarlo del camión
 *   ya_no_va     el pedido DEJÓ de tocarle: le quitaron el domicilio o se quedó sin
 *                factura. Lo pidió la sesión del reparto el 26/09/2026 y tenía razón:
 *                con el barrido esto se arreglaba solo —el pedido dejaba de aparecer—,
 *                pero con avisos filtrados nadie se lo dice nunca y se queda con él
 *                para siempre. Un pedido fantasma en un camión no lo echa en falta nadie.
 *   cliente      un CLIENTE se movió de sitio
 *
 * El del cliente no habla de pedidos y por eso no pasa por la regla de arriba: el reparto
 * trabaja con dónde ESTÁ la gente además de con qué se le lleva, y una dirección o unas
 * coordenadas que cambian le cambian la ruta aunque no se haya tocado ni un pedido. Un
 * cliente que se mudó y no se enteró el que conduce es una entrega que no llega.
 *
 * Un cambio de teléfono o de dirección no despierta a nadie: el reparto lo verá en su
 * ciclo lento. Llenar la cola de avisos que no llevan a ninguna acción es volver al
 * problema de origen, sólo que por el otro lado.
 *
 * # Por dónde sale
 *
 * Por los dos sitios, y no es redundancia:
 *
 *   la COLA    `procovar-delivery:in:orders`. Aguanta aunque el reparto esté apagado.
 *   el WEBHOOK si hay URL configurada, un POST firmado, con reintentos. Es para el que
 *              prefiere que le toquen la puerta a tener que leer una cola.
 *
 * Quien sólo tenga una de las dos, funciona igual.
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
import { encolarAvisoWebhook } from './queues';
import { emitEvent } from './events';

/**
 * El pedido entero, pedido tarde y sin poder romper nada.
 *
 * Tarde —`await import`— por lo mismo que prisma: este módulo lo carga medio proyecto y
 * arrastrar aquí el mapeador de la integración ataría los dos para siempre.
 *
 * Y si falla, el aviso sale igual, sin pedido dentro: enterarse a medias es mejor que no
 * enterarse, y el reparto siempre puede pedirlo.
 */
async function loQueLleva(
  cambio: CambioParaElReparto,
  aviso: AvisoReparto,
): Promise<{ pedido?: unknown; cliente?: unknown }> {
  if (!aviso.id) return {};

  try {
    const lib = await import('./pedidoParaIntegracion');

    if (cambio.entidad === 'cliente') return { cliente: await lib.clienteCompletoPorId(aviso.id) };
    // Ni en el borrado ni en el `ya_no_va` se manda el pedido: lo que se dice es
    // «quítalo del camión», y mandar el pedido con eso invita a guardarlo otra vez.
    if (cambio.motivo === 'borrado' || cambio.motivo === 'ya_no_va') return {};

    return { pedido: await lib.pedidoCompletoPorId(aviso.id) };
  } catch (e) {
    console.error('[aviso-reparto] no se pudo armar la carga:', (e as Error).message);

    return {};
  }
}

/**
 * Prisma se pide cuando hace falta, no al importar el módulo.
 *
 * `prismaClient` abre la conexión en cuanto se carga, así que importarlo arriba obligaba
 * a tener una base en pie sólo para poder mirar cómo se arma un aviso. Aquí la parte que
 * decide QUÉ se manda es pura y se prueba sola; la que lee el interruptor es la única
 * que necesita base, y la pide ella.
 */
async function base() {
  return (await import('../prismaClient')).default;
}

/** Lo que el reparto necesita saber de un cambio. Todo texto: un stream es campo/valor. */
export interface AvisoReparto {
  /** `pedido` o `cliente`. De qué habla el aviso, porque ya no todos hablan de pedidos. */
  entidad: string;
  /**
   * POR QUÉ se avisa. Es lo que le dice al reparto qué hacer sin tener que adivinarlo:
   *
   *   factura      apareció la factura, o cambió — el pedido ya se puede cargar
   *   domicilio    le pusieron el precio del domicilio: es repartible
   *   importacion  entró por una tanda de CSV — viene CON id salvo que sean muchos
   *   borrado      se borró: quítalo del camión
   *   ya_no_va     sigue existiendo, pero ya no es del reparto: quítalo igual
   *   cliente      el cliente se movió de sitio; el `id` es el del CLIENTE
   */
  motivo: string;
  /** Qué le pasó, con las palabras de PEDIDO: `update`, `delete`, `igual`, `cambiado`… */
  accion: string;
  /**
   * El id de la entidad: del pedido, o del CLIENTE cuando `entidad` lo dice.
   *
   * Vacío sólo en los avisos de tanda grande, que son «mira esa sucursal».
   */
  id: string;
  /** De qué sucursal. Vacío = no se sabe, y entonces el reparto mira todas. */
  sucursalId: string;
  /** Cuándo, en milisegundos. Sirve para medir el retraso de punta a punta. */
  ts: string;
}

export interface CambioParaElReparto {
  id?: string | null;
  sucursalId?: string | null;
  motivo: 'factura' | 'domicilio' | 'importacion' | 'borrado' | 'ya_no_va' | 'cliente';
  accion?: string;
  /** `pedido` salvo que se diga otra cosa. Hoy la otra cosa es `cliente`. */
  entidad?: 'pedido' | 'cliente';
  /**
   * Si ya se sabe si le toca al reparto, se dice aquí y no se vuelve a mirar.
   *
   * Hace falta para el BORRADO: cuando el aviso sale, el pedido ya no está en la base y
   * no hay a quién preguntarle si iba a domicilio. Lo mira quien borra, que lo tiene
   * delante, y lo manda decidido.
   */
  esDelReparto?: boolean;
}

/** Lo mínimo que hay que leer del pedido para saber si le toca al reparto. */
export const CAMPOS_PARA_DECIDIR = {
  requiere_domicilio: true,
  facturaDomicilio: true,
  facturaNumero: true,
  facturaEstado: true,
} as const;

export interface PedidoParaDecidir {
  requiere_domicilio?: boolean | null;
  facturaDomicilio?: number | null;
  facturaNumero?: string | null;
  facturaEstado?: string | null;
}

/**
 * ¿Este pedido es de los que lleva el reparto?
 *
 * Puro y exportado para poder probarlo: es la regla que decide qué sale de aquí, y una
 * regla que se equivoca por el lado flojo llena la cola de ruido, y por el lado estricto
 * deja pedidos sin repartir sin que nadie se entere. Las dos formas de fallar son caras
 * y ninguna avisa.
 */
/**
 * LA MISMA REGLA, en forma de `where` de Prisma.
 *
 * Va pegada a `esParaElReparto` a propósito y no en la ruta que la usa: son la misma
 * decisión escrita dos veces —una para un objeto que ya está en memoria y otra para la
 * base— y separarlas es cómo se llega a que el resumen cuente unos pedidos y el aviso
 * mande otros. Si cambia una, cambia la otra, y están a la vista la una de la otra.
 */
export const DONDE_ES_PARA_EL_REPARTO: {
  AND: Array<Record<string, unknown>>;
} = {
  AND: [
    { OR: [{ requiere_domicilio: true }, { facturaDomicilio: { gt: 0 } }] },
    { OR: [{ facturaNumero: { not: null } }, { facturaEstado: { in: ['igual', 'cambiado'] } }] },
  ],
};

export function esParaElReparto(p: PedidoParaDecidir | null | undefined): boolean {
  if (!p) return false;

  // Dos señales de que va a domicilio. La de la factura manda aunque la casilla esté en
  // blanco: si se cobró la entrega, se entrega, lo diga o no el que tomó el pedido.
  const aDomicilio = p.requiere_domicilio === true || (p.facturaDomicilio ?? 0) > 0;

  // Y facturado. `sin_factura` es «se comprobó y no la tiene», que no es tenerla.
  const facturado =
    Boolean(p.facturaNumero) || p.facturaEstado === 'igual' || p.facturaEstado === 'cambiado';

  return aDomicilio && facturado;
}

/**
 * Arma el aviso. Puro y aparte para poder probarlo: lo que se manda importa tanto como
 * que se mande, y un campo con `undefined` dentro rompe el `XADD` entero.
 */
export function armarAviso(c: CambioParaElReparto, ahora: () => number = Date.now): AvisoReparto {
  return {
    entidad: c.entidad || 'pedido',
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
 * Manda la BASE, no el `.env`: así se apaga desde la pantalla de Sincronización cuando
 * el reparto esté caído o haciendo obras, sin volver a desplegar. Si no hay fila —una
 * instalación recién levantada— vale lo que diga `DELIVERY_EVENTS`, que es como estaba
 * antes de que esto tuviera pantalla.
 *
 * Con caché corto porque esto se pregunta en cada cambio de pedido y la respuesta
 * cambia una vez cada muchos meses. Quince segundos es lo que tarda en notarse un
 * cambio desde la pantalla, que es de sobra.
 */
const ID_CONFIG = 'reparto';
const VIGENCIA_MS = 15000;
let _cache: { at: number; activo: boolean } | null = null;

export function porDefectoDelEntorno(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.DELIVERY_EVENTS || '').trim().toLowerCase() === 'true';
}

export async function avisosEncendidos(): Promise<boolean> {
  if (_cache && Date.now() - _cache.at < VIGENCIA_MS) return _cache.activo;

  let activo = porDefectoDelEntorno();
  try {
    const fila = await (await base()).webhookConfig.findUnique({ where: { id: ID_CONFIG } });
    if (fila) activo = fila.activo;
  } catch {
    // Sin base no se puede preguntar: vale lo del entorno y no se cachea el fallo.
    return activo;
  }

  _cache = { at: Date.now(), activo };

  return activo;
}

/** Lo enciende o lo apaga desde la pantalla, y tira el caché para que se note ya. */
export async function ponerAvisos(activo: boolean): Promise<boolean> {
  const fila = await (await base()).webhookConfig.upsert({
    where: { id: ID_CONFIG },
    update: { activo },
    create: { id: ID_CONFIG, activo },
  });

  _cache = { at: Date.now(), activo: fila.activo };
  // El interruptor es global, no de una sucursal: va sin `sucursalId` para que lo vean
  // todas las pantallas abiertas. Quien lo pulsó ya lo tiene pintado; esto es para la
  // segunda pestaña, que si no se queda diciendo lo contrario.
  emitEvent('reparto', { accion: 'interruptor' });

  return fila.activo;
}

/**
 * ¿Le toca al reparto este pedido? Lo mira en la base si no vino ya decidido.
 *
 * Los avisos de tanda (`importacion` sin id) no tienen pedido que mirar: ésos los filtra
 * quien importa, que es el único que sabe qué entró.
 */
async function leToca(cambio: CambioParaElReparto): Promise<boolean> {
  if (typeof cambio.esDelReparto === 'boolean') return cambio.esDelReparto;
  // Un cliente que se movió le interesa siempre: no hay factura que mirar.
  if (cambio.entidad === 'cliente') return true;
  // Y `ya_no_va` dice justamente que la regla ya NO se cumple: medirlo con ella sería
  // callar el único aviso que avisa de eso.
  if (cambio.motivo === 'ya_no_va') return true;
  if (!cambio.id) return true;

  const p = await (await base()).pedido.findUnique({
    where: { id: cambio.id },
    select: CAMPOS_PARA_DECIDIR,
  });

  return esParaElReparto(p);
}

/**
 * Deja el aviso en la bandeja del reparto, y le toca la puerta si tiene URL.
 *
 * Best-effort de verdad: no se espera, no lanza y no puede tumbar lo que lo llamó. Un
 * pedido que se completa no se puede quedar a medias porque Redis no conteste.
 */
export function avisarAlReparto(cambio: CambioParaElReparto): void {
  void (async () => {
    try {
      if (!(await avisosEncendidos())) return;
      if (!(await leToca(cambio))) return;

      const aviso = armarAviso(cambio);

      const plano = aviso as unknown as Record<string, string>;

      // A la COLA va el aviso pelado. Quien la lee tiene la API al lado y puede pedir lo
      // que quiera; meterle el pedido entero a cada mensaje sería llenar Redis de copias
      // de lo que ya está en la base.
      const idDelAviso = await xaddReparto(plano);

      /*
       * Al WEBHOOK va el pedido ENTERO, que es lo contrario y también a propósito.
       *
       * Quien recibe un POST no tiene por qué volver a llamarnos para enterarse de lo
       * que acabamos de contarle: eso es la mitad del sondeo otra vez, y con la red de
       * las sucursales, media vuelta de más por pedido se nota. Va el pedido con su
       * cliente —con coordenadas—, su vendedor y sus líneas con los pesos ya resueltos:
       * con eso el reparto guarda y arma la ruta sin llamar a nadie.
       *
       * En el BORRADO no hay pedido que mandar —ya no está— y va el aviso solo: eso es
       * exactamente lo que dice, «quítalo del camión».
       */
      await encolarAvisoWebhook({
        // Con su identificador, para que el reparto descarte los repetidos: sus
        // reintentos sobre un aviso ya aplicado tienen que salirle «sin efecto», no
        // aplicarse otra vez. Si no hubo Redis no hay id, y entonces se compone uno
        // estable con lo que sí se sabe: el mismo aviso reintentado da el mismo.
        aviso: { ...aviso, avisoId: idDelAviso || `${aviso.motivo}:${aviso.id || aviso.sucursalId || 'tanda'}:${aviso.ts}` },
        ...(await loQueLleva(cambio, aviso)),
      });

      // Y que la pantalla lo vea AHORA. Va al final a propósito: se avisa de lo que ya
      // salió, no de lo que se iba a intentar. Sin datos —los contadores los recalcula
      // el endpoint— así que el front hace un refresco de fondo, sin esqueleto.
      emitEvent('reparto', { id: cambio.id ?? null, sucursalId: cambio.sucursalId ?? null, accion: 'salida' });
    } catch (e) {
      console.error('[aviso-reparto] no se pudo avisar:', (e as Error).message);
    }
  })();
}

export { STREAM_REPARTO };

/**
 * Este pedido YA NO es del reparto: que lo quite.
 *
 * Se llama desde los dos sitios donde eso pasa de verdad —se cancela el domicilio, o el
 * cotejo deja al pedido sin factura— y NO desde la regla general: si saliera cada vez que
 * la regla dice que no, saldría un `ya_no_va` por cada pedido de mostrador que se
 * factura, que son casi todos. Sería el ruido de antes con otro nombre.
 */
export function avisarQueYaNoVa(cambio: Omit<CambioParaElReparto, 'motivo' | 'esDelReparto'>): void {
  avisarAlReparto({ ...cambio, motivo: 'ya_no_va', esDelReparto: true });
}
