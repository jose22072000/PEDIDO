// Worker de colas Redis (Bull). Proceso APARTE de la API: misma imagen, otro comando:
//   node dist/worker.js
// Consume la cola procovar-pedido:import-csv y procesa las importaciones de CSV FUERA
// del request, con concurrencia acotada (IMPORT_CONCURRENCY). Requiere REDIS_URL; sin
// él no hay colas que consumir (la API entonces importa inline y este worker sobra).
import 'dotenv/config';
import { redisEnabled, publishJSON, anotarLatencia, CH_IMPORT_DONE, CH_IMPORT_FAILED } from './lib/redis';
import { importQueue, parrandaQueue, webhooksQueue, repasoFacturasQueue, QUEUE_IMPORT, QUEUE_PARRANDA, QUEUE_WEBHOOKS } from './lib/queues';
import { entregarWebhook } from './lib/webhook';
import { emitEvent } from './lib/events';
import { processBulkImport } from './routes/orders';
import { processParrandaSync } from './lib/parranda';
import { arrancarSondeoVentra } from './lib/sondeoVentra';
import { arrancarCotejoFacturacion, cotejarUnaVez } from './lib/cotejoFacturacion';
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
    /**
     * El progreso se guarda EN EL JOB, que es lo que puede leer la API.
     *
     * El worker corre en otro contenedor, así que no hay forma de preguntarle. Bull deja
     * el progreso en Redis junto al job y desde la API se lee sin tocar al worker: eso es
     * lo que alimenta la barra que ven los operadores.
     *
     * Si escribir el progreso falla, la importación sigue: es información, no el trabajo.
     */
    const outcome = await processBulkImport(
      records as any[],
      uploaderSucursalId,
      restrictToGestorId ?? null,
      (hechos, total, parcial) => {
        // Lo que va entrando, no sólo por dónde va: «320 de 500» no dice si está
        // creando pedidos o fallando todos.
        void job.progress({ hechos, total, ...parcial, at: Date.now() }).catch(() => {});
      },
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

  // Y la FACTURACIÓN contra los pedidos: qué se facturó de verdad, y corregir el pedido
  // cuando no coincide. Aquí por lo mismo que el catálogo —son diez consultas por VPN— y
  // además porque al corregir le pide el precio del domicilio a delivery: es una cadena
  // que puede tardar, y la API no tiene por qué esperarla.
  arrancarCotejoFacturacion();

  // La tasa de cambio, de la API de Amado. Aquí por lo mismo que el catálogo: es
  // trabajo de fondo y la API no tiene por qué esperarlo.
  arrancarTasaCambio();

  // El teléfono del cliente, sacado de sus propios pedidos. Aquí y no en la API porque
  // es un repaso a toda la tabla: no puede colgar del arranque de quien atiende.
  arrancarTelefonos();

  arrancarWebhooks();

  // Y el repaso del mes, después de cerrar. Ver `programarRepasoFacturas`.
  const rq = repasoFacturasQueue();

  if (rq) {
    rq.process(1, procesarRepaso);
    await programarRepasoFacturas(rq);
  } else {
    console.log('[worker] sin Redis: no hay repaso de facturación programado');
  }
}

/**
 * Repasar TODO lo que lleva el mes y arreglar lo que quedara mal.
 *
 * # Por qué hace falta, si ya hay dos carriles
 *
 * El rápido y la pasada de diez minutos sólo miran los últimos días. Un pedido cuya
 * factura entró tarde —o que se facturó con el folio mal escrito y se corrigió después—
 * se queda fuera de esa ventana para siempre, marcado «sin factura», y nadie vuelve a
 * mirarlo. Este repaso vuelve a pasar por el mes entero: lo que estuviera mal, se arregla.
 *
 * # Por qué DESPUÉS de las seis
 *
 * Porque durante el día la facturación está a medias. Un pedido tomado a las once que
 * todavía no se ha facturado no está mal: está **en proceso**. Concluir a mediodía que
 * «no apareció» sería mentir la mitad de las veces. A las seis las sucursales cierran, y
 * lo que a esa hora no tiene factura es que de verdad no la tiene.
 */
async function procesarRepaso() {
  const hasta = new Date();
  const desde = new Date(hasta.getFullYear(), hasta.getMonth(), 1);

  console.log(`[repaso] mes desde ${desde.toISOString().slice(0, 10)}`);

  const rs = await cotejarUnaVez({ desde });
  const ok = rs.filter((r) => !r.error);
  const suma = (f: (r: (typeof ok)[number]) => number) => ok.reduce((a, r) => a + f(r), 0);
  const mal = rs.filter((r) => r.error);

  console.log(
    `[repaso] ${suma((r) => r.cotejados)} pedidos del mes · ` +
      `${suma((r) => r.igual)} igual, ${suma((r) => r.cambiado)} cambiados, ` +
      `${suma((r) => r.sinFactura)} sin factura · ${suma((r) => r.corregidos)} corregidos` +
      (mal.length ? ` · fallaron ${mal.map((r) => r.sucursal).join(', ')}` : ''),
  );
}

/**
 * Programa el repaso para todos los días después de cerrar.
 *
 * A las 18:30 y no a las 18:00 a propósito: a las seis en punto ya corre el sync de
 * clientes de Parranda, y las dos cosas juntas son diez consultas por la VPN peleándose.
 * Media hora después, el sync ya terminó y las sucursales llevan un rato cerradas.
 *
 * La hora es de Cuba. Con el servidor en UTC, «las seis» serían las dos de la tarde, con
 * las sucursales facturando todavía — que es justo lo que este repaso no puede hacer.
 *
 * Se limpian los repetibles antes de programar: Bull los guarda con una clave que incluye
 * el cron, así que cambiar la hora sin limpiar deja los DOS y se repasaría dos veces.
 */
async function programarRepasoFacturas(rq: NonNullable<ReturnType<typeof repasoFacturasQueue>>) {
  const cron = process.env.REPASO_FACTURAS_CRON || '30 18 * * *';
  const tz = process.env.REPASO_FACTURAS_TZ || 'America/Havana';

  try {
    for (const r of await rq.getRepeatableJobs()) {
      await rq.removeRepeatableByKey(r.key);
    }

    await rq.add({}, { repeat: { cron, tz }, removeOnComplete: 20, removeOnFail: 50 });
    console.log(`[worker] repaso de facturación programado (${cron}, ${tz})`);
  } catch (e) {
    // Que no se programe no puede tumbar al worker: los otros dos carriles siguen.
    console.error('[worker] no se pudo programar el repaso:', (e as Error).message);
  }
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
  // La cola de salida ya no existe: Entrega no necesita que PEDIDO le avise de
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
