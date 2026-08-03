import { crearStoreDatos } from "../crearStoreDatos";

/**
 * Store de reportes. La forma del resultado cambia según el reporte
 * (por estado, por fecha, por vendedor, productos por vendedor), así que el
 * tipo concreto lo fija cada vista al usarlo.
 *
 * Los reportes dependen de un rango de fechas: la vista pasa `activo: false`
 * mientras falten, para no pedir nada a medias.
 */
export const { useStore: useReportesStore, usar: usarReporte } =
  crearStoreDatos<unknown>(["pedido"]);
