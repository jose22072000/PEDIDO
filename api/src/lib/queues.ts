// Colas Bull sobre el Redis compartido.
// Igual que redis.ts: si Redis está deshabilitado, importQueue() devuelve null y
// el llamador cae al camino INLINE. Prefijo por app: procovar-pedido:*
import Queue from 'bull';
import { Redis } from 'ioredis';
import { getConnection, PREFIX } from './redis';

export const QUEUE_IMPORT = `${PREFIX}:import-csv`;

let _importQueue: Queue.Queue | null = null;

/** Cola de importación de CSV. Devuelve null si Redis está deshabilitado. */
export function importQueue(): Queue.Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_importQueue) {
    // Bull pide 3 clientes: 'client', 'subscriber' y 'bclient' (bloqueante).
    // Reusamos la conexión general para 'client'. Para 'subscriber'/'bclient' Bull EXIGE
    // explícitamente enableReadyCheck:false Y maxRetriesPerRequest:null: el default de
    // ioredis (enableReadyCheck:true) basta para que Bull tire "not permitted"
    // (OptimalBits/bull#1873), así que hay que setear AMBOS a mano — no alcanza con
    // duplicar la conexión ni con omitirlos.
    const redisUrl = process.env.REDIS_URL || '';
    _importQueue = new Queue(QUEUE_IMPORT, {
      createClient: (type) => {
        if (type === 'client') return conn;
        return new Redis(redisUrl, { enableReadyCheck: false, maxRetriesPerRequest: null });
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return _importQueue;
}
