import { crearStoreDatos, type OpcionesUso } from "../crearStoreDatos";

/**
 * Store de reportes.
 *
 * La forma del resultado cambia según el reporte (por estado, por fecha, por
 * vendedor, productos por vendedor), así que el store guarda `unknown` y el tipo
 * concreto lo fija cada vista al usarlo, con `usarReporte<T>`.
 *
 * Estrechar el tipo aquí es seguro porque cada vista prefija su clave de caché
 * con el nombre de SU reporte ("fecha:…", "estado:…", "vendedor:…"), así que dos
 * reportes distintos nunca comparten entrada.
 *
 * Los reportes se generan A MANO (botón Generar), no al montar la vista: por eso
 * cada una pasa `activo: false` hasta que el usuario los pide. Y usan una ventana
 * de frescura larga (FRESCO_LARGO_MS): son consultas caras y volver a la vista no
 * debe relanzarlas.
 */
const { useStore, usar } = crearStoreDatos<unknown>(["pedido"]);

export const useReportesStore = useStore;

export function usarReporte<T>(
  clave: string,
  traer: (signal: AbortSignal) => Promise<T>,
  opciones: Omit<OpcionesUso<T>, "aplicar"> = {},
) {
  const r = usar(clave, traer as (s: AbortSignal) => Promise<unknown>, opciones);

  return { ...r, datos: r.datos as T | null };
}
