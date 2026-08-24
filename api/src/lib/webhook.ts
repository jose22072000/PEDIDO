// Webhooks configurables. DOS destinos, la misma tabla (WebhookConfig, una fila por
// destino) y la misma pantalla de Configuración:
//
//   parranda   -> el aviso de "pedido completado" de siempre.
//   domicilio  -> la APK de domicilio. En los DOS sentidos: le avisamos de que hay un
//                 pedido que cotizar, y el secret de esta misma fila es con el que
//                 verificamos el costo que nos devuelven.
//
// Un solo secret por destino para ida y vuelta, no dos: son los dos extremos de la
// misma conversación. Con un secret por sentido, el día que se rote uno, alguien rota
// el que no era y la mitad de los mensajes se caen sin que nadie sepa cuál de los dos
// mirar.
//
// La config vive en la DB y la edita el SUPER ADMIN desde la UI — NO por .env. Eso es
// lo que permite cambiar la URL o rotar el secret sin volver a desplegar.
import crypto from 'crypto';
import prisma from '../prismaClient';

export type Destino = 'parranda' | 'domicilio';

export type ConfigWebhook = { url: string; key: string; secret: string; activo: boolean };

// Cache corto para no pegarle a la DB en cada envío: la config cambia una vez al año y
// el worker manda en ráfagas de cientos.
const _cache = new Map<Destino, { at: number; cfg: ConfigWebhook }>();
const VIGENCIA_MS = 15000;

export async function getConfig(destino: Destino): Promise<ConfigWebhook> {
  const c = _cache.get(destino);
  if (c && Date.now() - c.at < VIGENCIA_MS) return c.cfg;

  let cfg: ConfigWebhook = { url: '', key: '', secret: '', activo: true };
  try {
    const row = await prisma.webhookConfig.findUnique({ where: { id: destino } });
    if (row) cfg = { url: row.url || '', key: row.apiKey || '', secret: row.secret || '', activo: row.activo };
  } catch {
    /* sin tabla/DB todavía: no-op */
  }
  _cache.set(destino, { at: Date.now(), cfg });
  return cfg;
}

/** Invalida el cache (llamar al guardar la config desde la UI). Sin destino, todos. */
export function invalidarWebhookCache(destino?: Destino): void {
  if (destino) _cache.delete(destino);
  else _cache.clear();
}

/** La firma que viaja en X-Webhook-Signature. La misma fórmula para mandar y para verificar. */
export function firmar(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Compara dos firmas sin filtrar por dónde dejan de parecerse.
 *
 * Un `===` sobre cadenas corta en el primer byte distinto, y el tiempo que tarda dice
 * cuántos acertó. Con eso se adivina una firma byte a byte sin conocer el secret.
 */
export function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST del payload al destino. LANZA si no se pudo entregar: es lo que hace que Bull
 * lo reintente. Para el camino best-effort (el de Parranda) está `enviarWebhook`.
 */
export async function entregarWebhook(destino: Destino, payload: unknown): Promise<void> {
  const { url, key, secret, activo } = await getConfig(destino);
  if (!url || !activo) return; // sin configurar todavía: no es un fallo, es que no aplica

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['X-Webhook-Key'] = key;
  if (secret) headers['X-Webhook-Signature'] = firmar(secret, body);

  // Sin timeout, un receptor colgado deja el job ocupando un hueco del worker hasta que
  // el sistema operativo se aburra. Con la cola llena, eso es la cola parada.
  const corta = AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS || 15000));
  const res = await fetch(url, { method: 'POST', headers, body, signal: corta });
  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`${url} -> ${res.status} ${detalle}`);
  }
}

/** Igual, pero best-effort: nunca rompe el request que lo dispara. */
export async function enviarWebhook(destino: Destino, payload: unknown): Promise<void> {
  try {
    await entregarWebhook(destino, payload);
  } catch (e) {
    console.error(`[webhook:${destino}] falló:`, (e as Error).message);
  }
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

  void enviarWebhook('parranda', {
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
