// Tickets efímeros de un solo uso para autenticar conexiones SSE (EventSource).
//
// EventSource no puede mandar headers, así que el token viajaba en la URL (?token=),
// que se filtra por logs de nginx/referer/historial. En su lugar: el front pide un
// TICKET con su Bearer normal (header, POST) y abre el SSE con ?ticket=<id>. El ticket
// dura ~30s, es de un solo uso (GETDEL atómico) y lleva el scope ya resuelto.
//
// Store: Redis si está disponible (sirve multi-instancia); si no, un Map en memoria
// (suficiente para 1 instancia). No expone el token del usuario.
import { randomBytes } from 'node:crypto';
import { getConnection } from './redis';

export interface SseTicketData {
  sucursalId: string | null;
}

const KEY = (id: string) => `procovar-pedido:sse-ticket:${id}`;
const TTL_SEC = 30;

const mem = new Map<string, { data: SseTicketData; exp: number }>();

/** Crea un ticket de un solo uso con el scope ya resuelto. Devuelve el id. */
export async function mintSseTicket(data: SseTicketData): Promise<string> {
  const id = randomBytes(24).toString('hex');
  const conn = getConnection();
  if (conn) {
    await conn.set(KEY(id), JSON.stringify(data), 'EX', TTL_SEC);
  } else {
    mem.set(id, { data, exp: Date.now() + TTL_SEC * 1000 });
  }
  return id;
}

/** Consume (y borra) un ticket. Devuelve su scope, o null si es inválido/expirado. */
export async function consumeSseTicket(id: string | undefined | null): Promise<SseTicketData | null> {
  if (!id) return null;
  const conn = getConnection();
  if (conn) {
    const raw = await conn.getdel(KEY(id)); // atómico: leer + borrar (un solo uso)
    if (!raw) return null;
    try { return JSON.parse(raw) as SseTicketData; } catch { return null; }
  }
  const e = mem.get(id);
  if (!e) return null;
  mem.delete(id);
  if (e.exp < Date.now()) return null;
  return e.data;
}
