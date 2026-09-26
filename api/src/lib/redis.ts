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
export async function xaddReparto(campos: Record<string, string>): Promise<void> {
  if (!connection) return;
  try {
    const pares = Object.entries(campos).flat();
    await connection.xadd(STREAM_REPARTO, 'MAXLEN', '~', String(TOPE_STREAM), '*', ...pares);
  } catch (e) {
    console.error(`[redis] xadd ${STREAM_REPARTO} falló:`, (e as Error).message);
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
