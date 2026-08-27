import { Router } from 'express';
import prisma from '../prismaClient';
import { getRequesterContext } from '../lib/sucursalContext';
import { tasaActual, ponerTasa, traerTasa, HORAS_FRESCA } from '../lib/tasaCambio';

/**
 * La tasa de cambio USD -> CUP.
 *
 * Leerla puede cualquiera que esté dentro: la necesita toda pantalla que enseñe un
 * importe. Cambiarla, sólo quien administra — una tasa mal puesta desajusta TODO lo que
 * se ve en CUP a la vez.
 */
const router = Router();

router.get('/', async (req, res) => {
  /**
   * La tasa de la sucursal que se esté mirando, no una global.
   *
   * El código puede venir por query (?sucursalCodigo=STG) o del contexto de quien
   * pregunta. Sin ninguno se devuelve la de respaldo — que es lo que había antes para
   * todas, y era el fallo: los importes de Santiago salían convertidos con la tasa de
   * La Habana, sin que nada lo dijera.
   */
  const codigoDirecto = typeof req.query.sucursalCodigo === 'string' ? req.query.sucursalCodigo.trim() : '';
  const id = typeof req.query.sucursalId === 'string' ? req.query.sucursalId.trim() : '';
  // El front guarda el ID de la sucursal; las tasas se guardan por CÓDIGO. La traducción
  // se hace aquí y no allí para que el navegador no tenga que llevarse el mapa entero.
  const pedida = codigoDirecto
    || (id ? (await prisma.sucursal.findUnique({ where: { id }, select: { codigo: true } }))?.codigo ?? null : null);
  const t = await tasaActual(pedida);

  if (!t) {
    /**
     * Corto: esto se pinta en una etiqueta al lado del selector de moneda.
     *
     * Dice DE QUÉ sucursal falta, que es lo único accionable — "no hay tasa" a secas
     * hace pensar que no hay ninguna en el sistema. El porqué de no usar la de otra
     * sucursal está en el comentario de `tasaActual`, que es donde hace falta leerlo.
     */
    return res.json({
      tasa: null,
      sucursal: pedida || null,
      aviso: pedida ? `sin tasa para ${pedida}` : 'todavía no hay tasa configurada',
    });
  }
  res.json({
    ...t,
    sucursal: pedida || null,
    horasFresca: HORAS_FRESCA,
    // Se dice si está vieja en vez de dejar que alguien cobre con ella creyendo que
    // es de hoy. El número solo no lo puede decir.
    aviso: t.fresca ? null : `La tasa es del ${t.traidoAt.toLocaleDateString('es')} y puede estar desfasada.`,
  });
});

router.put('/', async (req, res) => {
  if (!getRequesterContext(req).isSuperAdmin) {
    return res.status(403).json({ error: 'Sólo el Super Admin puede cambiar la tasa.' });
  }
  const v = Number(req.body?.cupPorUsd);
  if (!Number.isFinite(v) || v <= 0) {
    return res.status(400).json({ error: 'La tasa tiene que ser un número mayor que cero.' });
  }
  const quien = getRequesterContext(req).username || 'manual';
  res.json(await ponerTasa(v, quien));
});

/** Forzar el refresco desde la API de Amado, sin esperar al ciclo. */
router.post('/traer', async (req, res) => {
  if (!getRequesterContext(req).isSuperAdmin) {
    return res.status(403).json({ error: 'Sólo el Super Admin.' });
  }
  const r = await traerTasa();
  res.status(r.ok ? 200 : 502).json(r);
});

export default router;
