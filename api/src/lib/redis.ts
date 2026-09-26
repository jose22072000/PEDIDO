// Cliente Redis OPCIONAL y Sentinel-ready para PEDIDO.
//
// Diseño clave: Redis es OPCIONAL. PEDIDO arranca y funciona igual SIN Redis.
//   - Sin REDIS_URL ni REDIS_SENTINELS  -> DESHABILITADO. El SSE cae a polling
//     (comportamiento original). No se rompe nada en producción.
//   - Con REDIS_URL                     -> conexión ioredis simple.
//   - Con REDIS_SENTINELS + REDIS_MASTER_NAME -> modo Sentinel (HA multi-nodo).
//
// Prefijo por app para NO colisionar en un Redis compartido (pedido vs delivery):
//   canales/colas = procovar-pedido:*
import { Redis, type RedisOptions } from 'ioredis';

export const PREFIX = 'procovar-pedido';
// (CH_ORDERS_NEW retirado: el SSE de pedidos usa el canal unico CH_EVENTS.)
// Eventos de la cola de importación de CSV (el worker publica; el SSE los reenvía al front).
export const CH_IMPORT_DONE = `${PREFIX}:import:done`;
export const CH_IMPORT_FAILED = `${PREFIX}:import:failed`;
// Canal GENÉRICO de cambios: cualquier vista suscrita a /events/stream se refresca en vivo.
// Payload: { tipo, sucursalId, id, accion, ts }. Scopeado por sucursal en el SSE.
export const CH_EVENTS = `${PREFIX}:events`;

const COMMON: RedisOptions = {
  maxRetriesPerRequest: null,               // requerido por BullMQ (Rebanada 2)
  retryStrategy: (times) => Math.min(times * 200, 3000),
};

function makeConnection(): Redis | null {
  const sentinels = (process.env.REDIS_SENTINELS || '').trim();
  const masterName = (process.env.REDIS_MASTER_NAME || '').trim();
  const url = (process.env.REDIS_URL || '').trim();

  if (sentinels && masterName) {
    const nodes = sentinels.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [host, port] = s.split(':');
      return { host, port: Number(port || 26379) };
    });
    return new Redis({ ...COMMON, sentinels: nodes, name: masterName });
  }
  if (url) return new Redis(url, COMMON);
  return null;
}

const connection = makeConnection();
const enabled = connection !== null;
// El publisher puede reusar la conexión general; el subscriber DEBE ser aparte
// (una conexión en modo subscribe no puede ejecutar otros comandos).
const subscriber = connection ? connection.duplicate() : null;

let loggedError = false;
for (const [name, c] of [['redis', connection], ['redis-sub', subscriber]] as const) {
  c?.on('error', (e: Error) => {
    if (!loggedError) { console.error(`[redis:${name}] ${e.message} (se reintenta en background)`); loggedError = true; }
  });
  c?.on('ready', () => { loggedError = false; console.log(`[redis:${name}] conectado`); });
}

export function redisEnabled(): boolean {
  return enabled;
}

/**
 * La bandeja de entrada del REPARTO: una cola de verdad, no un grito.
 *
 * `CH_EVENTS` es pub/sub: quien no está escuchando en ese instante se lo pierde. Vale
 * para refrescar una pantalla abierta —si te pierdes uno, el siguiente te pone al día—,
 * pero no para avisar a otro sistema: si el reparto está reiniciándose cuando entra un
 * pedido, ese pedido no llega nunca y nadie se entera.
 *
 * Por eso esto es un STREAM. Lo publicado se queda hasta que alguien lo lee, sobrevive a
 * que el consumidor se caiga, y con un grupo de consumidores se sabe qué se ha procesado
 * y qué no.
 *
 * El nombre lleva el prefijo de DELIVERY y no el de PEDIDO a propósito: es su bandeja,
 * nosotros sólo dejamos ahí el correo. Ya estaba escrito así en `.env.vps.example`.
 */
export const STREAM_REPARTO = (process.env.DELIVERY_STREAM || 'procovar-delivery:in:orders').trim();

/**
 * Cuántos avisos se guardan como mucho.
 *
 * Con `MAXLEN ~` Redis recorta por lo aproximado, que es mucho más barato que el corte
 * exacto y da igual: el tope está para que un consumidor apagado una semana no se coma
 * la memoria del servidor, no para cuadrar un número. 20.000 avisos son varios días de
 * movimiento de las ocho sucursales.
 */
const TOPE_STREAM = Number(process.env.DELIVERY_STREAM_MAXLEN || 20000);

/**
 * Deja un aviso en la bandeja del reparto. No-op si Redis está deshabilitado. Nunca lanza.
 *
 * Los campos van planos (texto) porque un stream de Redis es pares campo/valor, no JSON.
 */
export async function xaddReparto(campos: Record<string, string>): Promise<string | null> {
  if (!connection) return null;
  try {
    const pares = Object.entries(campos).flat();

    /*
     * Devuelve el id de la entrada, que es EL identificador de ese aviso.
     *
     * Lo pide el reparto para poder descartar repetidos: sus tres reintentos sobre un
     * aviso que ya aplicó tienen que salirle como «sin efecto» y no aplicarse dos veces
     * —en `factura`, aplicarlo dos veces es reescribir un pedido que ya estaba bien—.
     *
     * Y es el MISMO id por los dos caminos, la cola y el webhook, así que mientras
     * convivan puede cruzarlos sin tener dos numeraciones que casar.
     */
    return String(await connection.xadd(STREAM_REPARTO, 'MAXLEN', '~', String(TOPE_STREAM), '*', ...pares));
  } catch (e) {
    console.error(`[redis] xadd ${STREAM_REPARTO} falló:`, (e as Error).message);

    return null;
  }
}

/**
 * Cómo va la bandeja: cuántos avisos hay, cuántos cogidos sin terminar y del último.
 *
 * Devuelve `null` en los números cuando no hay Redis o el stream aún no existe. `null`
 * no es cero: un cero dice «todo procesado» y tranquiliza, y «no se sabe» es otra cosa
 * muy distinta que en pantalla tiene que verse distinta.
 */
/**
 * Compara dos ids de stream (`<ms>-<n>`). No vale `>` entre cadenas: `"9-0"` saldría
 * mayor que `"10-0"`, y con milisegundos eso pasa en cuanto cambia el número de cifras.
 */
function mayorQue(a: string, b: string): boolean {
  const [am, an] = a.split('-').map(Number);
  const [bm, bn] = b.split('-').map(Number);

  if (!Number.isFinite(am) || !Number.isFinite(bm)) return false;

  return am !== bm ? am > bm : (an || 0) > (bn || 0);
}

export async function infoStream(clave: string, grupo: string): Promise<{
  hay: number | null;
  sinTerminar: number | null;
  masViejoSinTerminar: number | null;
  /** `true` si el tope de la cola llegó a tirar avisos que el reparto NO había leído. */
  tiradosSinLeer: boolean;
  ultimoAviso: number | null;
  grupoCreado: boolean;
  redis: boolean;
}> {
  const vacio = {
    hay: null,
    sinTerminar: null,
    masViejoSinTerminar: null,
    tiradosSinLeer: false,
    ultimoAviso: null,
    grupoCreado: false,
    redis: false,
  };
  if (!connection) return vacio;

  try {
    const hay = await connection.xlen(clave);

    // El último aviso, para saber cuánto hace que no pasa nada. El id de un stream es
    // `<milisegundos>-<n>`: la hora viene puesta por Redis y no hay que guardarla.
    let ultimoAviso: number | null = null;
    const ultimos = await connection.xrevrange(clave, '+', '-', 'COUNT', 1);
    if (ultimos?.length) {
      const ms = Number(String(ultimos[0][0]).split('-')[0]);
      if (Number.isFinite(ms)) ultimoAviso = ms;
    }

    // Los cogidos y sin reconocer. Si el grupo no existe todavía, Redis da error: eso
    // no es un fallo, es que el consumidor no se ha estrenado.
    let sinTerminar: number | null = null;
    let masViejoSinTerminar: number | null = null;
    let grupoCreado = false;
    let tiradosSinLeer = false;
    try {
      const p = (await connection.xpending(clave, grupo)) as unknown as [number, string | null, ...unknown[]];

      sinTerminar = Number(p?.[0] ?? 0);
      grupoCreado = true;

      /*
       * EL MÁS VIEJO SIN TERMINAR, que es EL número que dice si esto está atascado.
       *
       * «Hay 40 cogidos y sin reconocer» no distingue entre cuarenta que entraron hace
       * dos segundos —normal, se están trabajando— y cuarenta que llevan ahí desde
       * anoche, que es un consumidor muerto. El contador se ve igual en los dos casos.
       *
       * `XPENDING` sin más devuelve [cuántos, el id más viejo, el más nuevo, quiénes], y
       * el id de un stream lleva la hora dentro: `<milisegundos>-<n>`.
       *
       * La idea es de la sesión del reparto, que lo tiene en su pantalla para lo que
       * manda; del otro lado del mismo tubo hace la misma falta.
       */
      const ms = Number(String(p?.[1] ?? '').split('-')[0]);

      if (Number.isFinite(ms) && ms > 0) masViejoSinTerminar = ms;

      /*
       * ¿EL TOPE DE LA COLA LLEGÓ A TIRAR ALGO QUE EL REPARTO NO HABÍA LEÍDO?
       *
       * La cola está topada a ~20.000 avisos (`DELIVERY_STREAM_MAXLEN`). El tope hace
       * falta —sin él, un consumidor caído una semana llena el Redis— pero recortar es
       * BORRAR, y hasta ahora se borraba en silencio: un aviso tirado antes de leerse es
       * un pedido que el reparto no ve nunca, y desde fuera se parece a que no pasó nada.
       *
       * Redis guarda `max-deleted-entry-id`. Si es MAYOR que el último que el grupo
       * llegó a entregar, entonces lo que se tiró incluía avisos sin leer. Con el ritmo
       * de hoy —decenas al día— harían falta más de un mes de caída para llegar ahí,
       * pero «es improbable» no es «se vería».
       */
      const info = (await connection.xinfo('STREAM', clave)) as unknown as unknown[];
      const grupos = (await connection.xinfo('GROUPS', clave)) as unknown as unknown[][];
      const campo = (filas: unknown[], nombre: string): string => {
        for (let i = 0; i < filas.length; i += 2) if (filas[i] === nombre) return String(filas[i + 1]);

        return '';
      };
      const nuestro = grupos.find((g) => campo(g, 'name') === grupo);
      const tirado = campo(info, 'max-deleted-entry-id');
      const entregado = nuestro ? campo(nuestro, 'last-delivered-id') : '';

      tiradosSinLeer = Boolean(tirado) && Boolean(entregado) && mayorQue(tirado, entregado);
    } catch {
      sinTerminar = null;
    }

    return { hay, sinTerminar, masViejoSinTerminar, tiradosSinLeer, ultimoAviso, grupoCreado, redis: true };
  } catch (e) {
    console.error(`[redis] no se pudo leer ${clave}:`, (e as Error).message);
    return { ...vacio, redis: true };
  }
}

/**
 * Los últimos avisos de la bandeja, del más nuevo al más viejo.
 *
 * Se pagina con el id del último visto (`antes`) y no con un número de página: un
 * stream no tiene páginas fijas —entran avisos por arriba todo el rato— y la página 2
 * de hace un minuto ya no es la misma. Con el cursor, «los anteriores a éste» siempre
 * quiere decir lo mismo.
 */
export async function ultimosDelStream(
  clave: string,
  limite = 25,
  antes?: string,
): Promise<{ avisos: Array<Record<string, string> & { _id: string }>; siguiente: string | null }> {
  if (!connection) return { avisos: [], siguiente: null };

  try {
    // El cursor es EXCLUSIVO: `(id` en Redis quiere decir «desde ahí sin incluirlo».
    const hasta = antes ? `(${antes}` : '+';
    const filas = await connection.xrevrange(clave, hasta, '-', 'COUNT', limite);
    const avisos = (filas || []).map(([id, pares]) => {
      const o: Record<string, string> = {};
      for (let i = 0; i < pares.length; i += 2) o[pares[i]] = pares[i + 1];
      return { ...o, _id: String(id) };
    });

    return {
      avisos,
      // Si vino la página entera, es probable que haya más. Si vino a medias, no.
      siguiente: avisos.length === limite ? avisos[avisos.length - 1]._id : null,
    };
  } catch (e) {
    console.error(`[redis] no se pudieron leer los avisos de ${clave}:`, (e as Error).message);
    return { avisos: [], siguiente: null };
  }
}

/** Publica un evento JSON. No-op si Redis está deshabilitado. Nunca lanza. */
export async function publishJSON(channel: string, payload: unknown): Promise<void> {
  if (!connection) return;
  try {
    await connection.publish(channel, JSON.stringify(payload));
  } catch (e) {
    console.error(`[redis] publish ${channel} falló:`, (e as Error).message);
  }
}

/** Conexión dedicada para SUSCRIBIRSE (o null si Redis está deshabilitado). */
export function getSubscriber(): Redis | null {
  return subscriber;
}

/** Conexión general (para publicar y para las colas Bull). null si deshabilitado. */
export function getConnection(): Redis | null {
  return connection;
}

/**
 * Cuánto tarda un aviso desde que se encola hasta que sale.
 *
 * Vive en Redis y no en memoria porque quien entrega es el worker y quien lo enseña es
 * la API: son dos procesos. Se guardan las últimas 200 y nada más — interesa si ahora
 * mismo salen en el acto, no un histórico.
 */
/*
 * Dos series, y no una: un aviso EN VIVO y uno de RELLENO no miden lo mismo.
 *
 * Al reencolar 250 atrasados de golpe, los últimos esperan su turno y salen a los 8
 * segundos. Eso no es lento —es una ráfaga drenando—, pero metido en la misma mediana
 * que los avisos en vivo daba "salen en 7.497 ms" y hacía parecer que el webhook va
 * lento justo cuando está haciendo bien su trabajo. Un número que asusta sin motivo se
 * deja de mirar, y entonces no sirve para nada.
 *
 * El de EN VIVO es el que responde a "¿esto va en tiempo real?".
 */
export const K_WEBHOOK_LAT = `${PREFIX}:webhooks:latencias`;
export const K_WEBHOOK_LAT_RELLENO = `${PREFIX}:webhooks:latencias-relleno`;

export async function anotarLatencia(ms: number, relleno = false): Promise<void> {
  const conn = getConnection();
  if (!conn) return;
  const clave = relleno ? K_WEBHOOK_LAT_RELLENO : K_WEBHOOK_LAT;
  try {
    await conn.lpush(clave, `${Date.now()}:${Math.round(ms)}`);
    await conn.ltrim(clave, 0, 199);
  } catch {
    /* medir no puede romper la entrega */
  }
}

/** Resumen de las últimas entregas: cuántas, mediana, la peor, y cuándo fue la última. */
export async function resumenLatencias(relleno = false): Promise<{
  muestras: number; medianaMs: number | null; peorMs: number | null; ultimaEn: string | null;
} | null> {
  const conn = getConnection();
  if (!conn) return null;
  try {
    const filas = await conn.lrange(relleno ? K_WEBHOOK_LAT_RELLENO : K_WEBHOOK_LAT, 0, 199);
    const pares = filas.map((f) => f.split(':').map(Number)).filter((a) => a.length === 2 && !a.some(Number.isNaN));
    if (!pares.length) return { muestras: 0, medianaMs: null, peorMs: null, ultimaEn: null };
    const ms = pares.map((a) => a[1]).sort((a, b) => a - b);
    return {
      muestras: ms.length,
      medianaMs: ms[Math.floor(ms.length / 2)],
      peorMs: ms[ms.length - 1],
      ultimaEn: new Date(Math.max(...pares.map((a) => a[0]))).toISOString(),
    };
  } catch {
    return null;
  }
}
