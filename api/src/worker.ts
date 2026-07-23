// Worker de colas Redis (Bull). Proceso APARTE de la API: misma imagen, otro comando:
//   node dist/worker.js
// Consume la cola procovar-pedido:import-csv y procesa las importaciones de CSV FUERA
// del request, con concurrencia acotada (IMPORT_CONCURRENCY). Requiere REDIS_URL; sin
// él no hay colas que consumir (la API entonces importa inline y este worker sobra).
import 'dotenv/config';
import { redisEnabled, publishJSON, CH_IMPORT_DONE, CH_IMPORT_FAILED } from './lib/redis';
import { importQueue, QUEUE_IMPORT } from './lib/queues';
import { processBulkImport } from './routes/orders';

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
    const { records, uploaderSucursalId } = job.data as {
      records: unknown[];
      uploaderSucursalId: string | null;
    };
    const outcome = await processBulkImport(records, uploaderSucursalId);
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
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
