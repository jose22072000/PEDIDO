// Colas Bull sobre el Redis compartido. Si Redis está deshabilitado, los getters
// devuelven null y el llamador cae al camino INLINE / no-op.
import Queue from 'bull';
import { Redis } from 'ioredis';
import { getConnection, PREFIX } from './redis';

export const QUEUE_IMPORT = `${PREFIX}:import-csv`;
// Cola de INGESTA hacia delivery (namespace de delivery, Redis compartido): PEDIDO
// ENCOLA aquí cuando un pedido se crea o se geolocaliza; el worker de delivery la
// consume y procesa (event-driven, SIN polling). Durable: si delivery está caído, los
// jobs esperan.
export const QUEUE_DELIVERY_IN_ORDERS = 'procovar-delivery:in:orders';

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

/** Cola de ingesta de pedidos hacia delivery. null si Redis está deshabilitado. */
export function deliveryOrdersQueue(): Queue.Queue | null {
  return makeQueue(QUEUE_DELIVERY_IN_ORDERS);
}

/**
 * Encola un evento "pedido(s) cambiaron" para que delivery los procese (event-driven,
 * reemplaza el poll de 15s). Payload liviano: señala que hay que revisar pendientes.
 * No-op si Redis está deshabilitado; nunca lanza (no rompe el request que lo dispara).
 */
export async function enqueueDeliveryOrders(payload: {
  reason: string;
  sucursalCodigo?: string | null;
  externalId?: string | null;
}): Promise<void> {
  // OPT-IN: solo encola cuando delivery ya consume esta cola (DELIVERY_EVENTS=true). Sin
  // el flag NO encola -> delivery sigue con su mecanismo actual, sin jobs huérfanos.
  if (process.env.DELIVERY_EVENTS !== 'true') return;
  const q = deliveryOrdersQueue();
  if (!q) return;
  try {
    await q.add(payload);
  } catch (e) {
    console.error('[queues] enqueueDeliveryOrders falló:', (e as Error).message);
  }
}
