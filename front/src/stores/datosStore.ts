import { useEffect, useRef } from "react";
import { create } from "zustand";

import { useLiveEvents } from "@/hooks/use-live-events";

/**
 * Caché de datos en memoria, compartida por toda la app.
 *
 * El problema que resuelve: cada vista guardaba sus datos en su propio
 * useState. Al salir y volver, todo se perdía y había que pedirlo de nuevo — y
 * mientras llegaba, la pantalla mostraba esqueletos. Con enlaces de alta
 * latencia (medido: ~600 ms por petición hasta el servidor) eso hace que
 * navegar se sienta lentísimo aunque el servidor responda en 4 ms.
 *
 * Aquí los datos sobreviven a la navegación: volver a una vista los pinta al
 * instante y, si toca, se refrescan por detrás sin vaciar la pantalla.
 */

type Entrada<T = unknown> = {
  datos: T | null;
  cargando: boolean;
  error: string | null;
  /** Cuándo se trajeron por última vez (ms). Sirve para decidir si refrescar. */
  traidoEn: number;
};

type Estado = {
  entradas: Record<string, Entrada>;
  fijar: (clave: string, parcial: Partial<Entrada>) => void;
  limpiar: (prefijo?: string) => void;
};

const VACIA: Entrada = { datos: null, cargando: false, error: null, traidoEn: 0 };

export const useDatosStore = create<Estado>((set) => ({
  entradas: {},
  fijar: (clave, parcial) =>
    set((s) => ({
      entradas: {
        ...s.entradas,
        [clave]: { ...(s.entradas[clave] ?? VACIA), ...parcial },
      },
    })),
  limpiar: (prefijo) =>
    set((s) => {
      if (!prefijo) return { entradas: {} };
      const entradas = { ...s.entradas };

      for (const k of Object.keys(entradas)) {
        if (k.startsWith(prefijo)) delete entradas[k];
      }

      return { entradas };
    }),
}));

/** Cuánto se considera "fresco" un dato antes de refrescarlo al volver a la vista. */
const FRESCO_MS = 30_000;

type Opciones = {
  /** Entidades del SSE que deben refrescar este dato (ej. ["cliente"]). */
  tipos?: string[];
  /** Si false, no pide nada (p. ej. faltan filtros obligatorios). */
  activo?: boolean;
  /** Fuerza refresco al montar aunque el dato esté fresco. */
  siempreAlMontar?: boolean;
};

/**
 * Trae datos con caché, refresco en segundo plano y refresco por SSE.
 *
 * `cargando` solo es true cuando NO hay nada que mostrar todavía: las recargas
 * posteriores no vacían la pantalla ni disparan esqueletos.
 */
export function useDatos<T>(
  clave: string,
  traer: (signal: AbortSignal) => Promise<T>,
  { tipos = [], activo = true, siempreAlMontar = false }: Opciones = {},
) {
  const entrada = (useDatosStore((s) => s.entradas[clave]) ?? VACIA) as Entrada<T>;
  const fijar = useDatosStore((s) => s.fijar);

  // El fetcher cambia de identidad en cada render (closures sobre filtros), así
  // que se guarda en una ref: si no, el efecto se relanzaría sin parar.
  const traerRef = useRef(traer);

  traerRef.current = traer;

  const abortRef = useRef<AbortController | null>(null);

  const recargar = useRef(async (fondo = false) => {
    if (!activo) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();

    abortRef.current = ctrl;

    const hayDatos = useDatosStore.getState().entradas[clave]?.datos != null;

    // Esqueleto SOLO si no hay nada que enseñar. En una recarga de fondo, ni eso.
    fijar(clave, { cargando: !hayDatos && !fondo, error: null });

    try {
      const datos = await traerRef.current(ctrl.signal);

      fijar(clave, { datos, cargando: false, error: null, traidoEn: Date.now() });
    } catch (e) {
      if (ctrl.signal.aborted) return; // cancelada a propósito: no es un error
      // Si ya hay datos en pantalla, un fallo de red no debe borrarlos ni pintar
      // un error encima: se conserva lo último bueno y se reintentará.
      fijar(clave, {
        cargando: false,
        error: hayDatos ? null : e instanceof Error ? e.message : "Error desconocido",
      });
    }
  }).current;

  useEffect(() => {
    if (!activo) return;
    const e = useDatosStore.getState().entradas[clave];
    const fresco = e?.datos != null && Date.now() - (e.traidoEn || 0) < FRESCO_MS;

    // Si el dato está fresco se pinta al instante y no se pide nada: volver a
    // una vista deja de costar una vuelta al servidor.
    if (!fresco || siempreAlMontar) void recargar(e?.datos != null);

    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo]);

  // Refresco por SSE, siempre en segundo plano: los datos se sustituyen cuando
  // llegan, la pantalla no parpadea. El hook ya agrupa las ráfagas de eventos.
  useLiveEvents(tipos, () => {
    if (activo) void recargar(true);
  });

  return {
    datos: entrada.datos,
    cargando: entrada.cargando,
    error: entrada.error,
    /** Recarga manual (botón "actualizar"): muestra esqueleto si no hay datos. */
    recargar: (fondo = false) => recargar(fondo),
  };
}
