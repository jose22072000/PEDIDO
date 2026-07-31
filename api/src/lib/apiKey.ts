import crypto from 'crypto';
import type { Request } from 'express';
import prisma from '../prismaClient';
import { emitEvent } from './events';

// "pk_" + prefijo visible. El prefijo identifica la key sin revelar el secreto.
const PREFIX_LEN = 12; // "pk_" + 9 hex

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Genera una API key nueva. Devuelve el token EN CLARO (mostrar UNA sola vez). */
export function generateApiKey(): { token: string; prefix: string; tokenHash: string } {
  const secret = crypto.randomBytes(24).toString('hex'); // 48 hex
  const token = `pk_${secret}`;
  const prefix = token.slice(0, PREFIX_LEN);
  return { token, prefix, tokenHash: sha256(token) };
}

function clientIp(req: Request): string | null {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

/**
 * Verifica un token contra la tabla ApiKey. Si es válido (activa, no revocada, no
 * expirada) registra el uso (lastUsedAt/count/ip) sin bloquear y devuelve el registro;
 * si no, null.
 */
export async function verifyApiKeyToken(token: string, req?: Request) {
  if (!token || !token.startsWith('pk_')) return null;
  const prefix = token.slice(0, PREFIX_LEN);
  const key = await prisma.apiKey.findUnique({ where: { prefix } });
  if (!key || !key.activo || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  // Comparación en tiempo constante del hash.
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(key.tokenHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // Registrar uso (fire-and-forget: no debe frenar la petición).
  prisma.apiKey
    .update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), usageCount: { increment: 1 }, lastUsedIp: req ? clientIp(req) : undefined },
    })
    .catch(() => {});
  // En vivo (SSE): avisa al panel de API keys que hubo uso, para que se refresque sin
  // polling. Throttle: como máximo 1 evento cada 2s por key (si un proyecto llama muy
  // seguido no inunda el SSE de todos los clientes).
  const lastMs = key.lastUsedAt ? key.lastUsedAt.getTime() : 0;
  if (Date.now() - lastMs > 2000) emitEvent('apikey', { id: key.id });
  return key;
}

/**
 * Resuelve la auth servidor-a-servidor: acepta la SERVICE_API_KEY legacy (env, la de
 * delivery) O una key emitida en la tabla. Devuelve si es válida y su etiqueta.
 */
export async function resolveServiceKey(req: Request): Promise<{ ok: boolean; label?: string }> {
  const header = (req.headers['x-api-key'] || req.headers['X-Api-Key']) as string | undefined;
  if (!header) return { ok: false };
  if (process.env.SERVICE_API_KEY && header === process.env.SERVICE_API_KEY) {
    return { ok: true, label: 'legacy-env' };
  }
  const key = await verifyApiKeyToken(header, req);
  return key ? { ok: true, label: key.label } : { ok: false };
}
