// Worker de colas Redis (Bull). Proceso APARTE de la API: misma imagen, otro comando:
//   node dist/worker.js
// Consume la cola procovar-pedido:import-csv y procesa las importaciones de CSV FUERA
// del request, con concurrencia acotada (IMPORT_CONCURRENCY). Requiere REDIS_URL; sin
// él no hay colas que consumir (la API entonces importa inline y este worker sobra).
import 'dotenv/config';
import { redisEnabled, publishJSON, anotarLatencia, CH_IMPORT_DONE, CH_IMPORT_FAILED } from './lib/redis';
import { importQueue, parrandaQueue, webhooksQueue, QUEUE_IMPORT, QUEUE_PARRANDA, QUEUE_WEBHOOKS } from './lib/queues';
import { entregarWebhook } from './lib/webhook';
import { emitEvent } from './lib/events';
import { processBulkImport } from './routes/orders';
import { processParrandaSync } from './lib/parranda';
import { arrancarSondeoVentra } from './lib/sondeoVentra';
import { arrancarTelefonos } from './lib/telefonoCliente';
import { arrancarTasaCambio } from './lib/tasaCambio';

/**
 * Avisar a las pantallas de que salió un aviso, como mucho una vez cada pocos segundos.
 *
 * Un evento por entrega era pasarse: un relleno de 700 publicaba 700 eventos, el SSE se
 * los mandaba a TODAS las pestañas abiertas y cada una pedía los contadores otra vez.
 * Los contadores no cambian tanto como para eso, y lo que se ganaba era llenar de
 * tráfico enlaces que en las sucursales ya van justos.
 *
 * Los fallos NO pasan por aquí: ésos se avisan siempre, que son los que hay que mirar.
 */
let ultimoAviso = 0;
const AVISO_CADA_MS = Number(process.env.WEBHOOK_AVISO_MS || 4000);

function avisarPantallas(folio: string, relleno: boolean): void {
  const ahora = Date.now();
  if (ahora - ultimoAviso < AVISO_CADA_MS) return;
  ultimoAviso = ahora;
  emitEvent('webhook', { accion: 'entregado', datos: { folio, relleno } });
}

async function main() {
  if (!redisEnabled()) {
    console.error('[worker] REDIS_URL no configurado: no hay colas que consumir. Saliendo.');
    process.exit(1);
  }
  const queue = importQueue();
  if (!queue) {
    console.error('[worker] No se pudo crear la cola. Saliendo.');
    process.exit(1);
  }

  const concurrency = Number(process.env.IMPORT_CONCURRENCY || 2);
  queue.process(concurrency, async (job) => {
    const { records, uploaderSucursalId, restrictToGestorId } = job.data as {
      records: unknown[];
      uploaderSucursalId: string | null;
      restrictToGestorId?: string | null;
    };
    const outcome = await processBulkImport(
      records as any[],
      uploaderSucursalId,
      restrictToGestorId ?? null,
    );
    if (!outcome.ok) {
      // Colisión de vendedor: publica el fallo (el SSE lo reenvía al front) y falla el job.
      await publishJSON(CH_IMPORT_FAILED, { jobId: String(job.id), uploaderSucursalId, error: outcome.error });
      throw new Error(outcome.error);
    }
    await publishJSON(CH_IMPORT_DONE, {
      jobId: String(job.id),
      uploaderSucursalId,
      results: outcome.results,
    });
    return outcome.results;
  });

  queue.on('failed', (job, err) => console.error(`[worker] job ${job?.id} falló:`, err.message));
  console.log(`[worker] escuchando ${QUEUE_IMPORT} (concurrency=${concurrency})`);

  // Cola del sync de clientes desde Parranda. Secuencial (1 a la vez) para no
  // hammerear la API ni la DB. El endpoint POST /clientes/sync-parranda encola aquí.
  const pq = parrandaQueue();
  if (pq) {
    pq.process(1, async () => {
      console.log('[worker] Parranda: arrancando sync de clientes…');
      const r = await processParrandaSync((p) =>
        console.log(`[worker] Parranda progreso: pág ${p.paginas}, ${p.total} vistos, ${p.creados}+${p.actualizados} escritos`),
      );
      console.log('[worker] Parranda OK:', JSON.stringify(r));
      return r;
    });
    pq.on('failed', (job, err) => console.error(`[worker] Parranda job ${job?.id} falló:`, err.message));
    console.log(`[worker] escuchando ${QUEUE_PARRANDA} (concurrency=1)`);

    await programarSyncDiario(pq);
  }

  // El catálogo de Ventra: precio, peso y stock por sucursal.
  //
  // Vive aquí y no en la API porque es trabajo de fondo —diez catálogos por VPN cada
  // doce horas— y la API está atendiendo a ocho sucursales. Aquí puede tardar lo que
  // haga falta sin frenar a nadie.
  arrancarSondeoVentra();

  // La tasa de cambio, de la API de Amado. Aquí por lo mismo que el catálogo: es
  // trabajo de fondo y la API no tiene por qué esperarlo.
  arrancarTasaCambio();

  // El teléfono del cliente, sacado de sus propios pedidos. Aquí y no en la API porque
  // es un repaso a toda la tabla: no puede colgar del arranque de quien atiende.
  arrancarTelefonos();

  arrancarWebhooks();
}

/**
 * Los avisos salientes, de a pocos.
 *
 * Aquí y no en la API porque una importación de CSV crea cientos de pedidos de golpe:
 * mandar el aviso dentro del request convertiría una importación de dos segundos en
 * varios minutos, y si el receptor está caído, en varios minutos que además fallan.
 *
 * El job sólo lleva el id. El pedido se lee de la DB al entregarlo, así que un aviso
 * que llevaba diez minutos esperando en la cola sale con la última versión, no con la
 * foto de cuando se encoló.
 */
function arrancarWebhooks() {
  // La cola de salida ya no existe: delivery-apk no necesita que PEDIDO le avise de
  // los pedidos, porque el repartidor teclea el folio y el cliente ya lo tiene bajado.
  // Lo único que queda del domicilio es el webhook de ENTRADA, y ése lo atiende la API.
  return;
}

/**
 * El sync de clientes, todos los días a las 6 de la tarde.
 *
 * La pantalla de Configuración lo prometía —"se sincroniza solo todos los días a las
 * 6:00 pm"— y no lo hacía NADIE: no había cron en la API, ni aquí, ni un flujo en n8n.
 * Se veía en el historial: las últimas sincronizaciones eran a las 8:34, a las 11:38,
 * a las 19:59… horas sueltas, o sea todas a mano. Prometerlo y no hacerlo es peor que
 * no prometerlo: nadie revisa lo que cree que se hace solo.
 *
 * Va en el worker y no en la API porque la API corre con varias instancias detrás del
 * proxy y cada una habría disparado su propio sync a la misma hora. El worker es uno.
 *
 * La hora es de Cuba, no del servidor: "las seis de la tarde" es cuando cierran las
 * sucursales, y con el servidor en UTC serían las dos.
 *
 * Antes de programarlo se borran los repetibles que hubiera. Bull guarda el repetible
 * con una clave que incluye el cron, así que cambiar la hora sin limpiar deja los DOS
 * programados y se sincronizaría dos veces al día sin que nadie entienda por qué.
 */
async function programarSyncDiario(pq: NonNullable<ReturnType<typeof parrandaQueue>>) {
  const cron = process.env.PARRANDA_SYNC_CRON || '0 18 * * *';
  const tz = process.env.PARRANDA_SYNC_TZ || 'America/Havana';

  try {
    for (const r of await pq.getRepeatableJobs()) {
      await pq.removeRepeatableByKey(r.key);
    }

    await pq.add(
      {},
      {
        repeat: { cron, tz },
        // Sin historial: interesa que se haya hecho, no doscientas copias del job.
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    console.log(`[worker] Parranda: sync programado (${cron}, ${tz})`);
  } catch (e) {
    // Que no arranque el programador no puede tumbar al worker: sin esto se queda sin
    // consumir la cola y tampoco funcionaría el sync a mano.
    console.error('[worker] Parranda: no se pudo programar el sync diario:', (e as Error).message);
  }
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
