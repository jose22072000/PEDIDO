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
  // La lat/lng es la que usa delivery para calcular el costo del domicilio:
  // sin ella, ese cliente no se puede cotizar.
  latitud?: number | null;
  longitud?: number | null;
  // Quién trajo al cliente: el vendedor de su pedido más antiguo. No hay
  // relación directa cliente->vendedor; el api lo resuelve por los pedidos.
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
}

/** Store de clientes. Se refresca con los eventos SSE de tipo "cliente". */
export const { useStore: useClientesStore, usar: usarClientes } =
  crearStoreDatos<RespuestaClientes>(["cliente"]);
