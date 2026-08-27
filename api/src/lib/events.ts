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
  | 'reporte'
  | 'apikey'
  // El webhook de domicilio: cada aviso que sale mueve los contadores de
  // Configuración. Sin esto la pantalla se queda con los números de cuando se abrió.
  | 'webhook'
  // La tasa de cambio. La trae el worker cada 12 h, así que sin aviso una pantalla
  // abierta se queda con la de cuando se cargó — y con el selector CUP en gris diciendo
  // que no hay tasa cuando ya la hay.
  | 'tasa';

/** Qué le pasó a la entidad. Determina cómo la aplica el front sin recargar. */
export type AccionEvento = 'create' | 'update' | 'delete' | 'bulk' | 'change' | string;

/**
 * Tamaño máximo del evento. Redis pub/sub no tiene problema con esto, pero un
 * objeto enorme (un pedido con 300 items) por cada cambio satura enlaces lentos
 * —que es justo el caso de las sucursales—. Si se pasa, se manda el evento SIN
 * datos y el front cae al refresco de fondo de siempre.
 */
const MAX_DATOS_BYTES = 32 * 1024;

interface OpcionesEvento {
  sucursalId?: string | null;
  id?: string | null;
  accion?: AccionEvento;
  /**
   * La entidad COMPLETA, tal cual la devuelve su endpoint de lista. Con esto el
   * front la mete/actualiza/quita de lo que ya tiene en pantalla y NO vuelve a
   * pedir nada: se acabó el parpadeo de "recargar la vista entera por cada
   * evento". Sin `datos`, el front hace un refresco de fondo (sin esqueleto).
   */
  datos?: unknown;
}

/**
 * Emite un evento de cambio para que las vistas conectadas al SSE se actualicen EN VIVO
 * (sin recargar, sin polling). Best-effort: si Redis no está, no hace nada (las vistas
 * siguen con su carga normal). `sucursalId` scopea el evento: el SSE solo se lo manda a
 * quien pertenece a esa sucursal (el Super Admin, sin sucursal, recibe todos). Un evento
 * con sucursalId null se considera GLOBAL y llega a todos.
 */
export function emitEvent(tipo: EntidadEvento, opts: OpcionesEvento = {}): void {
  let datos = opts.datos ?? null;

  if (datos != null) {
    try {
      if (JSON.stringify(datos).length > MAX_DATOS_BYTES) datos = null;
    } catch {
      datos = null; // no serializable (ciclos, BigInt…): se manda sin datos
    }
  }

  void publishJSON(CH_EVENTS, {
    tipo,
    sucursalId: opts.sucursalId ?? null,
    id: opts.id ?? null,
    accion: opts.accion ?? 'change',
    datos,
    ts: Date.now(),
  });
}
