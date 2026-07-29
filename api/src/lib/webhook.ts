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

/**
 * A Parranda SOLO se le mandan SUS productos: la cerveza "Parranda" en 330/500/1500 ml y
 * la "Malta Guajira" en 330/1500 ml (la malta NO tiene 500). Todo lo demás del pedido se
 * ignora. Devuelve el formato en ml, o null si el ítem no es un producto Parranda.
 */
export function clasificarParranda(nombre: string): { producto: string; formatoMl: number } | null {
  const n = String(nombre || '').toUpperCase();
  const fmt = /0\.33L|(^|\D)330(\D|$)/.test(n) ? 330
    : /1\.5L|(^|\D)1500(\D|$)/.test(n) ? 1500
    : /0\.5L|(^|\D)500(\D|$)/.test(n) ? 500
    : 0;
  if (!fmt) return null;
  if (n.includes('PARRANDA')) return { producto: 'Parranda', formatoMl: fmt };            // 330/500/1500
  if (n.includes('MALTA') && fmt !== 500) return { producto: 'Malta Guajira', formatoMl: fmt }; // 330/1500
  return null;
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

/** Dispara (fire-and-forget) el evento "pedido completado" con SOLO los productos Parranda. */
export function notifyPedidoCompletado(p: {
  folio: string;
  completedAt: Date | null;
  fecha: Date | null;
  estado: string | null;
  cliente?: { codigo: string | null; nombre: string } | null;
  sucursal?: { codigo: string | null } | null;
  items?: Array<{ producto: string; unidades: number | null; packs: number | null }> | null;
}): void {
  const productos = (p.items || [])
    .map((it) => {
      const c = clasificarParranda(it.producto);
      return c ? { producto: c.producto, formatoMl: c.formatoMl, unidades: it.unidades ?? null, packs: it.packs ?? null } : null;
    })
    .filter(Boolean);

  void enviarWebhook({
    evento: 'pedido.completado',
    folio: p.folio,
    sucursalCodigo: p.sucursal?.codigo ?? null,
    clienteCodigo: p.cliente?.codigo ?? null,
    clienteNombre: p.cliente?.nombre ?? null,
    estado: p.estado,
    completadoEn: p.completedAt ? p.completedAt.toISOString() : null, // cuándo se efectivizó
    fecha: p.fecha ? p.fecha.toISOString() : null,
    productos, // SOLO Parranda (330/500/1500) + Malta Guajira (330/1500)
  });
}
