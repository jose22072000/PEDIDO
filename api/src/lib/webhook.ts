// Webhook PUSH configurable (ej. Parranda): notifica cuando un pedido se COMPLETA.
// La config (URL / KEY / SECRET / activo) vive en la DB (tabla WebhookConfig, fila
// "parranda") y la edita el SUPER ADMIN desde la UI de Mantenimiento — NO por .env.
//  - KEY  -> header X-Webhook-Key (identifica el origen).
//  - SECRET -> firma HMAC-SHA256 del body en X-Webhook-Signature (el receptor la verifica).
//  - Best-effort: NUNCA rompe el request que lo dispara (fire-and-forget + try/catch).
import crypto from 'crypto';
import prisma from '../prismaClient';

// Cache corto para no pegarle a la DB en cada envío (la config cambia poco).
let _cache: { at: number; cfg: { url: string; key: string; secret: string; activo: boolean } } | null = null;

async function getConfig() {
  if (_cache && Date.now() - _cache.at < 15000) return _cache.cfg;
  let cfg = { url: '', key: '', secret: '', activo: true };
  try {
    const row = await prisma.webhookConfig.findUnique({ where: { id: 'parranda' } });
    if (row) cfg = { url: row.url || '', key: row.apiKey || '', secret: row.secret || '', activo: row.activo };
  } catch {
    /* sin tabla/DB todavía: no-op */
  }
  _cache = { at: Date.now(), cfg };
  return cfg;
}

/** Invalida el cache (llamar al guardar la config desde la UI). */
export function invalidarWebhookCache(): void {
  _cache = null;
}

/** POST del payload al webhook configurado. No-op si no hay URL o está desactivado. */
export async function enviarWebhook(payload: unknown): Promise<void> {
  const { url, key, secret, activo } = await getConfig();
  if (!url || !activo) return;
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
