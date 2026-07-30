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

/**
 * SSE EN VIVO genérico: se suscribe al canal `/events/stream` y llama `onEvent` cuando
 * cambia alguna de las entidades `tipos` (ej. ["cliente"] para la vista de clientes).
 * Así cualquier vista se refresca sola, sin recargar ni polling. Reabre solo si se cae
 * (el ticket es de un solo uso). Auth por ticket efímero (mismo patrón que /orders/stream).
 *
 * `deps` fuerza reconexión cuando cambia el scope (p. ej. la sucursal seleccionada).
 */
export function useLiveEvents(
  tipos: string[],
  onEvent: (ev: LiveEvent) => void,
  deps: unknown[] = [],
) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const tiposKey = tipos.join(",");

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const conectar = async () => {
      try {
        const ticketRes = await fetch(`${getApiBaseUrl()}/events/sse-ticket`, {
          method: "POST",
        });
        if (!ticketRes.ok || cancelled) return;
        const { ticket } = await ticketRes.json();
        if (cancelled) return;

        es = new EventSource(
          `${getApiBaseUrl()}/events/stream?ticket=${encodeURIComponent(ticket)}`,
        );

        const quiere = tiposKey ? new Set(tiposKey.split(",")) : null;
        const handler = (e: Event) => {
          try {
            const ev = JSON.parse((e as MessageEvent).data) as LiveEvent;
            if (!quiere || quiere.has(ev.tipo)) cb.current(ev);
          } catch {
            /* mensaje inválido: ignora */
          }
        };
        // El backend nombra el evento SSE = tipo de entidad; escuchamos los que interesan.
        (quiere ? [...quiere] : TODOS).forEach((t) =>
          es!.addEventListener(t, handler),
        );

        es.addEventListener("error", () => {
          es?.close();
          if (!cancelled && !retry) {
            retry = setTimeout(() => {
              retry = null;
              conectar();
            }, 3000);
          }
        });
      } catch {
        /* sin stream en vivo si falla el ticket */
      }
    };

    conectar();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiposKey, ...deps]);
}
