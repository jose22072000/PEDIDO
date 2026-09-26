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

    const [cola, encendido, recibidosHoy, ultimoRecibido] = await Promise.all([
      infoStream(STREAM_REPARTO, 'espejo'),
      avisosEncendidos(),
      // Lo que ha entrado DE VUELTA hoy: pedidos con estado de reparto puesto.
      prisma.pedido.count({ where: { estadoEntregaAt: { gte: desdeHoy } } }),
      prisma.pedido.findFirst({
        where: { estadoEntregaAt: { not: null } },
        orderBy: { estadoEntregaAt: 'desc' },
        select: { folio: true, estadoEntrega: true, estadoEntregaAt: true, sucursalId: true },
      }),
    ]);

    res.json({
      enviar: {
        encendido,
        // De dónde sale el interruptor: si no hay fila, manda el `.env`, y conviene
        // que la pantalla lo diga para que nadie busque el botón que lo cambió.
        porDefecto: porDefectoDelEntorno(),
        stream: STREAM_REPARTO,
        // `null` cuando no hay Redis: no es cero, es «no se sabe», y en pantalla se
        // tiene que ver distinto — un cero tranquiliza y un «no se sabe» no.
        ...cola,
        // Qué dispara un aviso. Va en la respuesta y no escrito en la pantalla para
        // que no se queden en dos sitios distintos diciendo cosas distintas.
        motivos: [
          { motivo: 'factura', que: 'apareció la factura o cambió' },
          { motivo: 'domicilio', que: 'le pusieron el precio del domicilio' },
          { motivo: 'importacion', que: 'entró una tanda de CSV de esa sucursal' },
          { motivo: 'borrado', que: 'se borró el pedido y hay que quitarlo del camión' },
        ],
      },
      recibir: {
        // Esta dirección no tiene interruptor: es una ruta con clave. Si el reparto
        // tiene su clave, escribe; si no, recibe un 401 y se ve en sus propios logs.
        por: 'POST /integration/orders/:folio/estado-entrega',
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
