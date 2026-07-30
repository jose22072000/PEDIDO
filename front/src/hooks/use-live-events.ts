import { useEffect, useRef } from "react";
import { getApiBaseUrl } from "@/config";

export type LiveEvent = {
  tipo: string;
  sucursalId: string | null;
  id: string | null;
  accion: string;
  ts: number;
};

const TODOS = [
  "pedido",
  "cliente",
  "usuario",
  "vendedor",
  "meta",
  "sucursal",
  "config",
  "reporte",
];

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON: UNA sola conexión SSE para TODA la app (no una por vista). Antes cada
// vista abría su propio ticket + EventSource al montar → navegar costaba 2-3
// round-trips por vista (lento, sobre todo en enlaces de alta latencia tipo Starlink)
// y saturaba el api con aperturas/cierres. Ahora la conexión se abre UNA vez y las
// vistas solo registran/quitan un listener; navegar no reabre nada.
// ─────────────────────────────────────────────────────────────────────────────
type Listener = { tipos: Set<string> | null; cb: (ev: LiveEvent) => void };
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let connecting = false;
let retry: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry() {
  if (retry || listeners.size === 0) return;
  retry = setTimeout(() => {
    retry = null;
    void ensureConnected();
  }, 4000);
}

async function ensureConnected() {
  if (es || connecting) return;
  connecting = true;
  try {
    const r = await fetch(`${getApiBaseUrl()}/events/sse-ticket`, { method: "POST" });
    if (!r.ok) {
      connecting = false;
      scheduleRetry();

      return;
    }
    const { ticket } = await r.json();

    es = new EventSource(
      `${getApiBaseUrl()}/events/stream?ticket=${encodeURIComponent(ticket)}`,
    );
    const handler = (e: Event) => {
      let ev: LiveEvent;

      try {
        ev = JSON.parse((e as MessageEvent).data) as LiveEvent;
      } catch {
        return;
      }
      for (const l of listeners) {
        if (!l.tipos || l.tipos.has(ev.tipo)) l.cb(ev);
      }
    };

    TODOS.forEach((t) => es!.addEventListener(t, handler));
    es.addEventListener("error", () => {
      es?.close();
      es = null;
      scheduleRetry();
    });
    connecting = false;
  } catch {
    connecting = false;
    scheduleRetry();
  }
}

/**
 * SSE EN VIVO: registra un listener en la conexión ÚNICA compartida y llama `onEvent`
 * cuando cambia alguna de las entidades `tipos` (ej. ["cliente"]). No abre conexión
 * propia: montar/desmontar la vista solo agrega/quita el listener (navegación rápida).
 */
export function useLiveEvents(
  tipos: string[],
  onEvent: (ev: LiveEvent) => void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps: unknown[] = [],
) {
  const cb = useRef(onEvent);

  cb.current = onEvent;
  const tiposKey = tipos.join(",");

  useEffect(() => {
    const listener: Listener = {
      tipos: tiposKey ? new Set(tiposKey.split(",")) : null,
      cb: (ev) => cb.current(ev),
    };

    listeners.add(listener);
    void ensureConnected();

    return () => {
      listeners.delete(listener);
      // La conexión NO se cierra al desmontar una vista: queda abierta (1 sola) para
      // la sesión, así navegar entre vistas no la reabre. Se cae sola al cerrar la pestaña.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiposKey]);
}
