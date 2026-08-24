// Colas Bull sobre el Redis compartido. Si Redis está deshabilitado, los getters
// devuelven null y el llamador cae al camino INLINE / no-op.
import Queue from 'bull';
import { Redis } from 'ioredis';
import { getConnection, PREFIX } from './redis';

export const QUEUE_IMPORT = `${PREFIX}:import-csv`;

const _queues = new Map<string, Queue.Queue>();

function makeQueue(name: string): Queue.Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_queues.has(name)) {
    // Bull pide 3 clientes: 'client', 'subscriber' y 'bclient'. Reusamos la conexión
    // general para 'client'; para el resto, conexiones nuevas con enableReadyCheck:false
    // Y maxRetriesPerRequest:null (Bull lo exige; ver OptimalBits/bull#1873).
    const redisUrl = process.env.REDIS_URL || '';
    _queues.set(
      name,
      new Queue(name, {
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
      }),
    );
  }
  return _queues.get(name)!;
}

/** Cola de importación de CSV. null si Redis está deshabilitado. */
export function importQueue(): Queue.Queue | null {
  return makeQueue(QUEUE_IMPORT);
}

/** Cola del sync de clientes desde Parranda (Retool). null si Redis está deshabilitado. */
export const QUEUE_PARRANDA = `${PREFIX}:sync-clientes-parranda`;
export function parrandaQueue(): Queue.Queue | null {
  return makeQueue(QUEUE_PARRANDA);
}

/**
 * Cola de webhooks salientes. null si Redis está deshabilitado.
 *
 * Existe por una razón concreta: la importación de un CSV crea cientos de pedidos de
 * una sentada. Avisar de cada uno dentro del request convertiría una importación de
 * dos segundos en varios minutos —y si el receptor está caído, en varios minutos que
 * además fallan—. Encolar es instantáneo; el worker los va soltando de a pocos.
 */
export const QUEUE_WEBHOOKS = `${PREFIX}:webhooks`;
export function webhooksQueue(): Queue.Queue | null {
  return makeQueue(QUEUE_WEBHOOKS);
}

/**
 * Encola un aviso saliente. No-op si Redis está deshabilitado; nunca lanza (no puede
 * romper el request que lo dispara).
 *
 * El `jobId` es evento+pedido a propósito: mientras el aviso esté esperando en la cola,
 * volver a tocar el mismo pedido no encola un segundo. Un pedido que se edita cuatro
 * veces seguidas manda UN aviso, no cuatro, y como el worker lee el pedido de la DB al
 * entregarlo, ese aviso lleva ya la última versión.
 */
export async function encolarWebhook(evento: string, pedidoId: string): Promise<void> {
  const q = webhooksQueue();
  if (!q) return;
  try {
    await q.add({ evento, pedidoId }, { jobId: `${evento}:${pedidoId}` });
  } catch (e) {
    console.error('[queues] encolarWebhook falló:', (e as Error).message);
  }
}
