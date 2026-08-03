import { useEffect, useRef } from "react";
import { create } from "zustand";

import { useLiveEvents, type LiveEvent } from "@/hooks/use-live-events";

/**
 * Fábrica de stores de datos. Cada entidad tiene el SUYO (clientes, vendedores,
 * usuarios…), con sus tipos, pero la lógica de caché se escribe una sola vez.
 *
 * Qué resuelve: antes cada vista guardaba sus datos en su propio useState. Al
 * salir y volver se perdía todo y había que pedirlo de nuevo, mostrando
 * esqueletos mientras llegaba. Medido contra el servidor: ~600 ms por petición
 * (casi todo handshakes de red; el api responde en 4 ms). Con esa latencia,
 * navegar se sentía lentísimo aunque el servidor volara.
 *
 * Con esto:
 *  - los datos sobreviven a la navegación → volver a una vista es instantáneo
 *  - el esqueleto solo sale cuando NO hay nada que mostrar
 *  - los cambios que llegan por SSE se aplican EN SITIO sobre lo cacheado
 *    (opción `aplicar`), sin volver a pedir nada y sin parpadeo
 *  - cuando no se pueden aplicar, la recarga es en segundo plano
 *  - un fallo de red en una recarga de fondo no borra lo que ya se veía
 */

type Entrada<T> = {
  datos: T | null;
  cargando: boolean;
  error: string | null;
  traidoEn: number;
};

const VACIA = { datos: null, cargando: false, error: null, traidoEn: 0 };

/** Cuánto se considera fresco un dato antes de refrescarlo al volver a la vista. */
const FRESCO_MS = 30_000;

/**
 * Ventana larga para consultas CARAS que el usuario pide a mano (los reportes).
 * Volver a la vista no debe relanzar una agregación pesada por haber tardado
 * medio minuto en volver: si la quiere rehacer, está el botón de generar.
 */
export const FRESCO_LARGO_MS = 10 * 60_000;

export type StoreDatos<T> = {
  /** Una entrada por combinación de filtros/página. */
  entradas: Record<string, Entrada<T>>;
  fijar: (clave: string, parcial: Partial<Entrada<T>>) => void;
  /** Tira toda la caché de ESTA entidad (p. ej. tras un borrado masivo). */
  invalidar: () => void;
};

export type OpcionesUso<T> = {
  /** Entidades del SSE que refrescan este dato (ej. ["cliente"]). */
  tipos?: string[];
  /** Si false, no pide nada (faltan filtros obligatorios, permisos, etc.). */
  activo?: boolean;
  /** Cuánto dura fresco el dato. Por defecto 30 s; ver FRESCO_LARGO_MS. */
  frescoMs?: number;
  /**
   * Aplica la ráfaga de eventos SSE sobre lo que ya hay cacheado, sin tocar el
   * servidor. Devuelve el valor nuevo, o `null` si no se puede aplicar (una
   * importación masiva, un evento sin objeto): entonces se recarga, pero DE
   * FONDO. Si no se pasa, siempre se recarga de fondo.
   */
  aplicar?: (actual: T, lote: LiveEvent[]) => T | null;
};

/**
 * Crea el store de una entidad y el hook para consumirlo.
 *
 * @param tiposPorDefecto entidades del SSE que refrescan esta entidad
 */
export function crearStoreDatos<T>(tiposPorDefecto: string[] = []) {
  const useStore = create<StoreDatos<T>>((set) => ({
    entradas: {},
    fijar: (clave, parcial) =>
      set((s) => ({
        entradas: {
          ...s.entradas,
          [clave]: { ...(s.entradas[clave] ?? (VACIA as Entrada<T>)), ...parcial },
        },
      })),
    invalidar: () => set({ entradas: {} }),
  }));

  /**
   * @param clave  identifica la consulta (página + filtros). Cada combinación
   *               se cachea por separado. TIENE que incluir TODO lo que cambia
   *               el resultado: si falta un filtro, se enseñan datos de otro.
   * @param traer  función que pide los datos; recibe la señal de cancelación.
   */
  function usar(
    clave: string,
    traer: (signal: AbortSignal) => Promise<T>,
    { tipos = tiposPorDefecto, activo = true, aplicar, frescoMs = FRESCO_MS }: OpcionesUso<T> = {},
  ) {
    const entrada = useStore((s) => s.entradas[clave]) ?? (VACIA as Entrada<T>);
    const fijar = useStore((s) => s.fijar);

    // El fetcher y el aplicador cambian de identidad en cada render (cierran
    // sobre los filtros de la vista), así que se guardan en refs: si no, el
    // efecto se relanzaría sin parar.
    const traerRef = useRef(traer);

    traerRef.current = traer;

    const aplicarRef = useRef(aplicar);

    aplicarRef.current = aplicar;

    const abortRef = useRef<AbortController | null>(null);
    const claveRef = useRef(clave);

    claveRef.current = clave;

    const recargar = useRef(async (fondo = false) => {
      const k = claveRef.current;

      abortRef.current?.abort();
      const ctrl = new AbortController();

      abortRef.current = ctrl;

      const hayDatos = useStore.getState().entradas[k]?.datos != null;

      // Esqueleto SOLO si no hay nada que enseñar. En recarga de fondo, ni eso.
      fijar(k, { cargando: !hayDatos && !fondo, error: null });

      try {
        const datos = await traerRef.current(ctrl.signal);

        fijar(k, { datos, cargando: false, error: null, traidoEn: Date.now() });
      } catch (e) {
        if (ctrl.signal.aborted) {
          // Cancelada a propósito (cambió el filtro, se desmontó la vista). No
          // es un error, pero hay que bajar la bandera de "cargando" si nadie
          // ha tomado el relevo: si no, al volver se ve un esqueleto eterno.
          if (abortRef.current === ctrl) fijar(k, { cargando: false });

          return;
        }
        fijar(k, {
          cargando: false,
          // Si ya hay datos en pantalla, un fallo de red no debe borrarlos ni
          // pintar un error encima: se conserva lo último bueno.
          error: hayDatos ? null : e instanceof Error ? e.message : "Error desconocido",
        });
      }
    }).current;

    useEffect(() => {
      if (!activo) return;
      const e = useStore.getState().entradas[clave];
      const fresco = e?.datos != null && Date.now() - (e.traidoEn || 0) < frescoMs;

      // Dato fresco: se pinta al instante y no se pide nada. Volver a una vista
      // deja de costar una vuelta al servidor.
      if (!fresco) void recargar(e?.datos != null);

      return () => abortRef.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave, activo, frescoMs]);

    // Cambios en vivo. El hook ya agrupa las ráfagas, así que una importación de
    // cientos de pedidos produce UNA entrega. Si la vista sabe aplicar el lote,
    // se aplica en memoria y NO se toca el servidor; si no, recarga de fondo.
    useLiveEvents(tipos, (_ev, lote) => {
      if (!activo) return;
      const k = claveRef.current;
      const actual = useStore.getState().entradas[k]?.datos ?? null;
      const fn = aplicarRef.current;

      if (fn && actual != null) {
        const nuevo = fn(actual, lote);

        if (nuevo !== null) {
          // Misma referencia = nada que cambiar: ni se toca el store, así no se
          // provoca un render de balde.
          if (nuevo !== actual) fijar(k, { datos: nuevo, traidoEn: Date.now() });

          return;
        }
      }
      void recargar(true);
    });

    return {
      datos: entrada.datos,
      cargando: entrada.cargando,
      error: entrada.error,
      /** Recarga manual (botón "reintentar"/"actualizar"). */
      recargar: (fondo = false) => recargar(fondo),
      /**
       * Modifica lo cacheado SIN pedir nada al servidor. Para cambios que hace
       * la propia vista (borrar una fila, marcar completado) y que ya sabe el
       * resultado: se refleja al instante en vez de esperar una vuelta.
       */
      actualizar: (fn: (actual: T | null) => T | null) => {
        const k = claveRef.current;
        const actual = useStore.getState().entradas[k]?.datos ?? null;

        fijar(k, { datos: fn(actual) });
      },
    };
  }

  return { useStore, usar };
}
