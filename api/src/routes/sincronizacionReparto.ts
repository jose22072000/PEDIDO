/**
 * La pantalla de Sincronización › Reparto: las dos direcciones y si están funcionando.
 *
 * Son DOS caminos distintos y hasta ahora no se veían en ninguna parte:
 *
 *   ENVIAR   PEDIDO deja un aviso en la cola cuando un pedido ya se puede repartir
 *            (tiene factura, o cambió la factura, o le pusieron el domicilio).
 *   RECIBIR  el reparto escribe aquí el estado de lo que va entregando, por
 *            `/integration/orders/...`, con su clave de servicio.
 *
 * Lo que enseña esta pantalla no es «está configurado», que eso no dice nada, sino
 * **si está pasando algo**: cuántos avisos hay esperando, cuántos cogidos y sin
 * terminar, cuánto hace del último, y cuántos estados entraron hoy de vuelta. Un
 * sincronizado que se paró se ve igual que uno que va bien si sólo se mira la casilla
 * de «activo».
 */
import express from 'express';
import prisma from '../prismaClient';
import { authenticateToken } from '../middleware/auth';
import { getRequesterContext } from '../lib/sucursalContext';
import { avisosEncendidos, ponerAvisos, porDefectoDelEntorno, STREAM_REPARTO } from '../lib/avisoAlReparto';
import { infoStream, ultimosDelStream } from '../lib/redis';
import { getConfig } from '../lib/webhook';
import { webhooksQueue } from '../lib/queues';

const router = express.Router();

router.use(authenticateToken);

/** Sólo quien administra: aquí se ve el estado de las tripas, no datos de trabajo. */
function puedeVer(req: express.Request): boolean {
  const ctx = getRequesterContext(req);
  return Boolean(ctx.canManageUsers || ctx.isSuperAdmin || ctx.isGlobalAdmin);
}

/**
 * GET /sincronizacion/reparto
 *
 * Todo lo que hace falta para saber si las dos direcciones están vivas.
 */
router.get('/reparto', async (req, res) => {
  try {
    if (!puedeVer(req)) {
      return res.status(403).json({ error: 'Sólo administración puede ver la sincronización.' });
    }

    const desdeHoy = new Date();
    desdeHoy.setHours(0, 0, 0, 0);

    const q = webhooksQueue();

    const [cola, encendido, webhook, esperando, fallados, recibidosHoy, ultimoRecibido, claves] = await Promise.all([
      infoStream(STREAM_REPARTO, 'espejo'),
      avisosEncendidos(),
      getConfig('reparto'),
      q ? q.getWaitingCount().catch(() => null) : Promise.resolve(null),
      q ? q.getFailedCount().catch(() => null) : Promise.resolve(null),
      // Lo que ha entrado DE VUELTA hoy: pedidos con estado de reparto puesto.
      prisma.pedido.count({ where: { estadoEntregaAt: { gte: desdeHoy } } }),
      prisma.pedido.findFirst({
        where: { estadoEntregaAt: { not: null } },
        orderBy: { estadoEntregaAt: 'desc' },
        select: { folio: true, estadoEntrega: true, estadoEntregaAt: true, sucursalId: true },
      }),
      /*
       * QUIÉN puede escribirnos. Se enseña la etiqueta, el prefijo y cuándo se usó por
       * última vez; el token no existe en ningún sitio, sólo su hash.
       *
       * Una clave que nadie ha usado nunca y una que se usó hace un minuto se ven igual
       * en la lista de claves, y son cosas muy distintas: la primera es o una clave que
       * el otro extremo no tiene, o una que sobra y hay que revocar.
       */
      prisma.apiKey.findMany({
        where: { activo: true, revokedAt: null },
        select: { id: true, label: true, prefix: true, lastUsedAt: true, usageCount: true },
        orderBy: { lastUsedAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({
      enviar: {
        encendido,
        // De dónde sale el interruptor: si no hay fila, manda el `.env`, y conviene
        // que la pantalla lo diga para que nadie busque el botón que lo cambió.
        porDefecto: porDefectoDelEntorno(),
        stream: STREAM_REPARTO,
        /*
         * La otra puerta: un POST firmado a la URL que se configure. El secret NUNCA
         * vuelve —sólo si lo hay—, y la cola dice si está saliendo o atascándose.
         */
        webhook: {
          url: webhook.url,
          key: webhook.key,
          tieneSecret: Boolean(webhook.secret),
          activo: webhook.activo,
          esperando,
          fallados,
        },
        // `null` cuando no hay Redis: no es cero, es «no se sabe», y en pantalla se
        // tiene que ver distinto — un cero tranquiliza y un «no se sabe» no.
        ...cola,
        // Qué dispara un aviso. Va en la respuesta y no escrito en la pantalla para
        // que no se queden en dos sitios distintos diciendo cosas distintas.
        // La regla de qué sale. Va en la respuesta para que la pantalla no la repita por
        // su cuenta: dos sitios diciendo lo mismo acaban diciendo cosas distintas.
        regla: 'Sólo los pedidos que van a domicilio Y ya tienen factura.',
        motivos: [
          { motivo: 'factura', que: 'apareció la factura o cambió' },
          { motivo: 'domicilio', que: 'le pusieron el precio del domicilio' },
          { motivo: 'importacion', que: 'entró por una tanda de CSV y ya le toca' },
          { motivo: 'borrado', que: 'se borró el pedido y hay que quitarlo del camión' },
          { motivo: 'ya_no_va', que: 'dejó de ser suyo: sin domicilio o sin factura' },
          { motivo: 'cliente', que: 'el cliente se movió de sitio' },
        ],
      },
      recibir: {
        /*
         * La ruta de verdad, que es una sola y recibe LOTES —hasta 500 pedidos por
         * llamada—, no un pedido por petición. Estaba escrita aquí de memoria y no
         * existía: quien la hubiera copiado para configurar el otro extremo se habría
         * pasado la tarde contra un 404.
         */
        por: 'POST /integration/orders/status',
        formato: '{ pedidos: [{ pedidoId, estado, nota?, at? }] }',
        // Esta dirección no tiene interruptor: es una ruta con clave. Si el reparto
        // tiene su clave, escribe; si no, recibe un 401 y se ve en sus propios logs.
        claves: claves.map((k) => ({
          id: k.id,
          label: k.label,
          prefix: k.prefix,
          usada: k.lastUsedAt,
          veces: k.usageCount,
        })),
        recibidosHoy,
        ultimo: ultimoRecibido
          ? {
              folio: ultimoRecibido.folio,
              estado: ultimoRecibido.estadoEntrega,
              cuando: ultimoRecibido.estadoEntregaAt,
              sucursalId: ultimoRecibido.sucursalId,
            }
          : null,
      },
    });
  } catch (e) {
    console.error('Error leyendo el estado de la sincronización con el reparto:', e);
    res.status(500).json({ error: 'No se pudo leer el estado de la sincronización.' });
  }
});

/**
 * PUT /sincronizacion/reparto   body: { activo }
 *
 * Enciende o apaga los avisos SIN desplegar. Es lo que hace falta el día que el reparto
 * esté de obras: se apaga, deja de acumularse cola, y se vuelve a encender.
 */
router.put('/reparto', async (req, res) => {
  try {
    if (!puedeVer(req)) {
      return res.status(403).json({ error: 'Sólo administración puede tocar la sincronización.' });
    }

    const { activo } = req.body as { activo?: unknown };

    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'Falta `activo` (true o false).' });
    }

    res.json({ activo: await ponerAvisos(activo) });
  } catch (e) {
    console.error('Error cambiando la sincronización con el reparto:', e);
    res.status(500).json({ error: 'No se pudo guardar.' });
  }
});

/**
 * GET /sincronizacion/reparto/avisos?antes=<id>&limite=25
 *
 * Los avisos que hay en la bandeja, del más nuevo al más viejo. Es lo que contesta
 * «¿esto está trabajando?» de verdad: no un contador, sino QUÉ se está mandando.
 *
 * Se pagina con el id del último visto y no con un número de página: entran avisos por
 * arriba todo el rato y la página 2 de hace un minuto ya no es la misma.
 */
router.get('/reparto/avisos', async (req, res) => {
  try {
    if (!puedeVer(req)) {
      return res.status(403).json({ error: 'Sólo administración puede ver la sincronización.' });
    }

    const limite = Math.min(100, Math.max(5, Number(req.query.limite) || 25));
    const antes = typeof req.query.antes === 'string' && req.query.antes ? req.query.antes : undefined;

    res.json(await ultimosDelStream(STREAM_REPARTO, limite, antes));
  } catch (e) {
    console.error('Error leyendo los avisos del reparto:', e);
    res.status(500).json({ error: 'No se pudieron leer los avisos.' });
  }
});

export default router;
