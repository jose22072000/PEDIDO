import { crearStoreDatos } from "../crearStoreDatos";

export interface Cliente {
  id: string;
  nombre: string;
  codigo?: string | null;
  zona?: string | null;
  createdAt: string;
  direccion?: string | null;
  municipio?: string | null;
  tipoCliente?: string | null;
  estadoCompra?: string | null;
  /** Sale del pedido más reciente que traiga uno: antes sólo vivía en el pedido. */
  telefono?: string | null;
  // La lat/lng es la que usa delivery para calcular el costo del domicilio:
  // sin ella, ese cliente no se puede cotizar.
  latitud?: number | null;
  longitud?: number | null;
  // Quién trajo al cliente: el vendedor de su pedido más antiguo. No hay
  // relación directa cliente->vendedor; el api lo resuelve por los pedidos.
  /** La cruda del consolidado ("lat,lng" tal cual llegó), por si la parseada falla. */
  geolocalizacion?: string | null;
  /** Provincia: en Parranda es la provincia y aquí es la sucursal. Es el mismo dato. */
  sucursalNombre?: string | null;
  sucursalCodigo?: string | null;
  /** Distancia al almacén, medida por delivery-apk. Se guarda en el cliente, no en el pedido. */
  distanciaKm?: number | null;
  distanciaDesde?: string | null;
  distanciaAt?: string | null;
  /** Quién puso la ubicación: "apk" si la corrigió un repartidor, si no la de Parranda. */
  geoFuente?: string | null;
  geoAt?: string | null;
  updatedAt?: string | null;
  vendedorNombre?: string | null;
  vendedorCodigo?: string | null;
  /** Cuántos vendedores MÁS le han hecho pedidos, aparte del que lo trajo. */
  otrosVendedores?: number;
}

export interface PaginacionClientes {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RespuestaClientes {
  data: Cliente[];
  pagination: PaginacionClientes;
  municipios?: string[];
  /** Cuántos clientes echan en falta cada dato, con los filtros que estén puestos. */
  faltantes?: Record<string, number>;
}

/** Store de clientes. Se refresca con los eventos SSE de tipo "cliente". */
export const { useStore: useClientesStore, usar: usarClientes } =
  crearStoreDatos<RespuestaClientes>(["cliente"]);
