import { publishJSON, CH_EVENTS } from './redis';

// Entidades que emiten evento de cambio para el SSE en vivo (/events/stream).
export type EntidadEvento =
  | 'pedido'
  | 'cliente'
  | 'usuario'
  | 'vendedor'
  | 'meta'
  | 'sucursal'
  | 'config'
  | 'reporte';

/**
 * Emite un evento de cambio para que las vistas conectadas al SSE se refresquen EN VIVO
 * (sin recargar, sin polling). Best-effort: si Redis no está, no hace nada (las vistas
 * siguen con su carga normal). `sucursalId` scopea el evento: el SSE solo se lo manda a
 * quien pertenece a esa sucursal (el Super Admin, sin sucursal, recibe todos). Un evento
 * con sucursalId null se considera GLOBAL y llega a todos.
 */
export function emitEvent(
  tipo: EntidadEvento,
  opts: { sucursalId?: string | null; id?: string | null; accion?: string } = {},
): void {
  void publishJSON(CH_EVENTS, {
    tipo,
    sucursalId: opts.sucursalId ?? null,
    id: opts.id ?? null,
    accion: opts.accion ?? 'change',
    ts: Date.now(),
  });
}
