import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/config";

export type LiveEvent = {
  tipo: string;
  sucursalId: string | null;
  id: string | null;
  /** 'create' | 'update' | 'delete' | 'bulk' | ... */
  accion: string;
  /**
   * La entidad COMPLETA, con la misma forma que devuelve su endpoint de lista.
   * Si viene, la vista la aplica sobre lo que ya tiene y NO pide nada al
   * servidor: eso es lo que elimina el parpadeo. Si es null (cambios masivos,
   * objetos demasiado grandes), toca refrescar — pero de fondo, sin esqueleto.
   */
  datos?: unknown;
  ts: number;
};

// El servidor manda `event: ready` nada más abrir el stream. Va el PRIMERO en la
// lista a propósito: es la prueba de que la conexión está viva de verdad, y sin
// escucharlo el indicador dependía solo del evento `open` del navegador — que si
// no llegaba dejaba el cartel en "Conectando…" para siempre aunque el stream
// estuviera funcionando.
const TODOS = [
  "ready",
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

// Estado de la conexión compartida, para el indicador "En vivo". Vive aquí porque
// la conexión es una sola para toda la app: antes cada vista se lo inventaba con su
// propio EventSource y podía decir "en vivo" sin estarlo.
let conectado = false;
const oyentesEstado = new Set<(v: boolean) => void>();

function fijarConectado(v: boolean) {
  if (conectado === v) return;
  conectado = v;
  oyentesEstado.forEach((f) => f(v));
}

/** true mientras el stream SSE compartido esté abierto. */
export function useLiveStatus(): boolean {
  const [v, setV] = useState(conectado);

  useEffect(() => {
    oyentesEstado.add(setV);
    setV(conectado);

    return () => {
      oyentesEstado.delete(setV);
    };
  }, []);

  return v;
}

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
      // Recibir CUALQUIER cosa demuestra que el stream está vivo. Marcarlo aquí
      // (y no solo en `open`) hace que el indicador no dependa de un único evento.
      fijarConectado(true);

      // `ready` es solo el saludo del servidor: confirma la conexión y ya está,
      // no hay entidad que repartir.
      if (e.type === "ready") return;

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
    es.addEventListener("open", () => fijarConectado(true));
    es.addEventListener("error", () => {
      fijarConectado(false);
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

// Ventana para agrupar eventos seguidos. Una importación de CSV genera cientos
// de eventos de pedido en pocos segundos; sin agrupar, cada uno disparaba una
// recarga completa de la vista. Medido en el servidor: /api/orders/stats recibió
// 2.471 llamadas en 3 horas (~14 por minuto) por esta razón. Con enlaces de alta
// latencia eso deja la pantalla recargando sin parar.
//
// Se ejecuta al FINAL de la ráfaga (no al principio): así se recarga una vez, ya
// con todos los cambios aplicados, en vez de una vez por evento.
const AGRUPAR_MS = 1500;

/**
 * SSE EN VIVO: registra un listener en la conexión ÚNICA compartida y llama `onEvent`
 * cuando cambia alguna de las entidades `tipos` (ej. ["cliente"]). No abre conexión
 * propia: montar/desmontar la vista solo agrega/quita el listener (navegación rápida).
 *
 * Los eventos llegan AGRUPADOS: una ráfaga produce UNA sola llamada, o sea un solo
 * render. `onEvent` recibe el último evento y, como segundo argumento, TODOS los de
 * la ráfaga en orden. Ese lote es lo que permite aplicar los cambios en sitio: si se
 * pasara solo el último se perderían los demás objetos y habría que recargar.
 */
export function useLiveEvents(
  tipos: string[],
  onEvent: (ev: LiveEvent, lote: LiveEvent[]) => void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps: unknown[] = [],
) {
  const cb = useRef(onEvent);

  cb.current = onEvent;
  const tiposKey = tipos.join(",");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lote: LiveEvent[] = [];

    const listener: Listener = {
      tipos: tiposKey ? new Set(tiposKey.split(",")) : null,
      cb: (ev) => {
        lote.push(ev);
        if (timer) return; // ya hay una entrega programada para esta ráfaga
        timer = setTimeout(() => {
          timer = null;
          const enviar = lote;

          lote = [];
          if (enviar.length) cb.current(enviar[enviar.length - 1], enviar);
        }, AGRUPAR_MS);
      },
    };

    listeners.add(listener);
    void ensureConnected();

    return () => {
      listeners.delete(listener);
      if (timer) clearTimeout(timer); // no recargar una vista ya desmontada
      // La conexión NO se cierra al desmontar una vista: queda abierta (1 sola) para
      // la sesión, así navegar entre vistas no la reabre. Se cae sola al cerrar la pestaña.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiposKey]);
}
