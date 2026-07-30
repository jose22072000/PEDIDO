import { Router } from 'express';
import { resolveSucursalFilter } from '../lib/sucursalContext';
import { mintSseTicket, consumeSseTicket } from '../lib/sseTickets';
import { redisEnabled, getSubscriber, CH_EVENTS } from '../lib/redis';

// SSE GENÉRICO de cambios: una sola conexión por pestaña; cualquier vista se suscribe y se
// refresca en vivo cuando cambia SU entidad. Mismo modelo que /orders/stream: auth por
// TICKET efímero (no token en la URL) + aislamiento por sucursal.
const router = Router();

// POST /events/sse-ticket -> ticket efímero con el scope de sucursal ya resuelto.
router.post('/sse-ticket', async (req, res) => {
  const { sucursalId, error } = resolveSucursalFilter(req);
  if (error) return res.status(400).json({ error });
  const ticket = await mintSseTicket({ sucursalId: sucursalId ?? null });
  return res.json({ ticket });
});

// GET /events/stream?ticket=... -> stream de eventos { tipo, sucursalId, id, accion, ts }.
router.get('/stream', async (req, res) => {
  const ticket = await consumeSseTicket(req.query.ticket as string | undefined);
  if (!ticket) return res.status(401).json({ error: 'Ticket inválido o expirado' });
  const sucursalId = ticket.sucursalId ?? undefined; // undefined = Super Admin: ve TODAS.

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('ready', { since: new Date().toISOString() });
  const keepAlive = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);

  if (!redisEnabled()) {
    // Sin Redis no hay pub/sub: la conexión queda viva (keep-alive) pero no emite. Las
    // vistas siguen con su carga normal; no rompe nada.
    req.on('close', () => { closed = true; clearInterval(keepAlive); });
    return;
  }

  const sub = getSubscriber()!;
  await sub.subscribe(CH_EVENTS);
  const onMessage = (channel: string, message: string) => {
    if (closed || channel !== CH_EVENTS) return;
    try {
      const ev = JSON.parse(message);
      // Aislamiento: si el que escucha tiene sucursal, solo recibe eventos de ESA sucursal
      // (o globales, sucursalId null). El Super Admin (sucursalId undefined) recibe todos.
      if (sucursalId && ev.sucursalId && ev.sucursalId !== sucursalId) return;
      send(String(ev.tipo || 'change'), ev);
    } catch { /* mensaje inválido: ignora */ }
  };
  sub.on('message', onMessage);
  req.on('close', () => {
    closed = true;
    clearInterval(keepAlive);
    sub.off('message', onMessage); // NO unsubscribe: otros clientes pueden seguir escuchando.
  });
});

export default router;
