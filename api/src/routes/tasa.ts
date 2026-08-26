import { Router } from 'express';
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

router.get('/', async (_req, res) => {
  const t = await tasaActual();
  if (!t) return res.json({ tasa: null, aviso: 'todavía no hay tasa configurada' });
  res.json({
    ...t,
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
