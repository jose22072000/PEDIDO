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
export const CH_ORDERS_NEW = `${PREFIX}:orders:new`;
// Eventos de la cola de importación de CSV (el worker publica; el SSE los reenvía al front).
export const CH_IMPORT_DONE = `${PREFIX}:import:done`;
export const CH_IMPORT_FAILED = `${PREFIX}:import:failed`;

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
