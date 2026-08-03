import { crearStoreDatos } from "../crearStoreDatos";

// Tipos del listado de pedidos. Viven aquí (no en la vista) porque los comparten
// quien los pinta y quien los trae.

export interface OrderItem {
  id: string;
  producto: string;
  unidades: number;
  packs?: number | null;
  descripcion?: string | null;
}

export interface Cliente {
  id: string;
  nombre: string;
  codigo?: string | null;
  zona?: string | null;
}

export interface Vendedor {
  id: string;
  nombre: string;
  codigo?: string | null;
}

export interface Order {
  id: string;
  folio: string;
  vendedorId?: string | null;
  vendedor?: Vendedor | null;
  clienteId?: string | null;
  cliente?: Cliente | null;
  direccion?: string | null;
  encargado?: string | null;
  telefono?: string | null;
  fecha: string;
  fecha_comprometida?: string | null;
  estado: string;
  pedido_cobrado?: string | null;
  requiere_domicilio?: boolean | null;
  costoDomicilio?: number | null;
  createdAt: string;
  archivedAt?: string | null; // si tiene valor, el pedido está archivado (histórico)
  items: OrderItem[];
}

export interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RespuestaPedidos {
  data: Order[];
  pagination: PaginationData;
}

/**
 * Store de pedidos.
 *
 * NO declara tipos de SSE a propósito: esta vista tiene su propio canal
 * (/orders/stream), que manda el pedido COMPLETO y permite insertarlo en la
 * lista sin volver a pedirla. El canal genérico solo manda {tipo, id, accion},
 * que obligaría a recargar entera — una vuelta al servidor por cada pedido que
 * entra. Se conserva el canal dedicado y se usa `actualizar` para insertar.
 */
export const { useStore: usePedidosStore, usar: usarPedidos } =
  crearStoreDatos<RespuestaPedidos>([]);
