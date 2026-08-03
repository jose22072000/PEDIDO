import { useEffect, useRef } from "react";
import { create } from "zustand";

import { useLiveEvents } from "@/hooks/use-live-events";

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
 *  - las recargas por SSE son en segundo plano: la pantalla no parpadea
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

export type StoreDatos<T> = {
  /** Una entrada por combinación de filtros/página. */
  entradas: Record<string, Entrada<T>>;
  fijar: (clave: string, parcial: Partial<Entrada<T>>) => void;
  /** Tira toda la caché de ESTA entidad (p. ej. tras un borrado masivo). */
  invalidar: () => void;
};

export type OpcionesUso = {
  /** Entidades del SSE que refrescan este dato (ej. ["cliente"]). */
  tipos?: string[];
  /** Si false, no pide nada (faltan filtros obligatorios, permisos, etc.). */
  activo?: boolean;
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
   *               se cachea por separado.
   * @param traer  función que pide los datos; recibe la señal de cancelación.
   */
  function usar(
    clave: string,
    traer: (signal: AbortSignal) => Promise<T>,
    { tipos = tiposPorDefecto, activo = true }: OpcionesUso = {},
  ) {
    const entrada = useStore((s) => s.entradas[clave]) ?? (VACIA as Entrada<T>);
    const fijar = useStore((s) => s.fijar);

    // El fetcher cambia de identidad en cada render (cierra sobre los filtros),
    // así que se guarda en una ref: si no, el efecto se relanzaría sin parar.
    const traerRef = useRef(traer);

    traerRef.current = traer;

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
        if (ctrl.signal.aborted) return; // cancelada a propósito, no es un error
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
      const fresco = e?.datos != null && Date.now() - (e.traidoEn || 0) < FRESCO_MS;

      // Dato fresco: se pinta al instante y no se pide nada. Volver a una vista
      // deja de costar una vuelta al servidor.
      if (!fresco) void recargar(e?.datos != null);

      return () => abortRef.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave, activo]);

    // Refresco por SSE, siempre en segundo plano. El hook ya agrupa las ráfagas,
    // así que una importación de cientos de pedidos produce UNA recarga.
    useLiveEvents(tipos, () => {
      if (activo) void recargar(true);
    });

    return {
      datos: entrada.datos,
      cargando: entrada.cargando,
      error: entrada.error,
      /** Recarga manual (botón "reintentar"/"actualizar"). */
      recargar: (fondo = false) => recargar(fondo),
    };
  }

  return { useStore, usar };
}
