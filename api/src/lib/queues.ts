// Colas Bull sobre el Redis compartido.
// Igual que redis.ts: si Redis está deshabilitado, importQueue() devuelve null y
// el llamador cae al camino INLINE. Prefijo por app: procovar-pedido:*
import Queue from 'bull';
import { getConnection, PREFIX } from './redis';

export const QUEUE_IMPORT = `${PREFIX}:import-csv`;

let _importQueue: Queue.Queue | null = null;

/** Cola de importación de CSV. Devuelve null si Redis está deshabilitado. */
export function importQueue(): Queue.Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_importQueue) {
    // Bull pide 3 clientes: 'client', 'subscriber' y 'bclient' (bloqueante).
    // Reusamos la conexión general para 'client' y damos duplicados DEDICADOS a Bull
    // para el resto (no compartimos el subscriber del SSE).
    const bullSubscriber = conn.duplicate();
    _importQueue = new Queue(QUEUE_IMPORT, {
      createClient: (type) => {
        if (type === 'client') return conn;
        if (type === 'subscriber') return bullSubscriber;
        return conn.duplicate(); // bclient
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
