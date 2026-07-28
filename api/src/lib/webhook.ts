// Webhook PUSH configurable (ej. Parranda): notifica cuando un pedido se COMPLETA.
// - URL, KEY y SECRET vienen por ENV (configurables sin tocar código; cambiás la URL y
//   listo). Sin URL => no-op.
// - KEY viaja en el header X-Webhook-Key (identifica el origen).
// - SECRET firma el body (HMAC-SHA256) en X-Webhook-Signature: el receptor recalcula el
//   HMAC y confirma que los datos vinieron de nosotros y no se alteraron.
// - Best-effort: NUNCA rompe el request que lo dispara (todo en try/catch, fire-and-forget).
import crypto from 'crypto';

const cfg = () => ({
  url: process.env.PARRANDA_WEBHOOK_URL || '',
  key: process.env.PARRANDA_WEBHOOK_KEY || '',
  secret: process.env.PARRANDA_WEBHOOK_SECRET || '',
});

/** POST del payload al webhook configurado. No-op si no hay URL. */
export async function enviarWebhook(payload: unknown): Promise<void> {
  const { url, key, secret } = cfg();
  if (!url) return; // sin URL configurada: no se envía nada
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['X-Webhook-Key'] = key;
    if (secret) {
      headers['X-Webhook-Signature'] =
        'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    }
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) console.error(`[webhook] ${url} -> ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  } catch (e) {
    console.error('[webhook] falló:', (e as Error).message);
  }
}

/** Dispara (fire-and-forget) el evento "pedido completado" hacia el webhook de Parranda. */
export function notifyPedidoCompletado(p: {
  folio: string;
  completedAt: Date | null;
  fecha: Date | null;
  estado: string | null;
  cliente?: { codigo: string | null; nombre: string } | null;
  sucursal?: { codigo: string | null } | null;
}): void {
  void enviarWebhook({
    evento: 'pedido.completado',
    folio: p.folio,
    sucursalCodigo: p.sucursal?.codigo ?? null,
    clienteCodigo: p.cliente?.codigo ?? null,
    clienteNombre: p.cliente?.nombre ?? null,
    estado: p.estado,
    completadoEn: p.completedAt ? p.completedAt.toISOString() : null, // cuándo se efectivizó
    fecha: p.fecha ? p.fecha.toISOString() : null,
  });
}
