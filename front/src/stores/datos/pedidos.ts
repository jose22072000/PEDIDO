import { crearStoreDatos } from "../crearStoreDatos";

// Tipos del listado de pedidos. Viven aquí (no en la vista) porque los comparten
// quien los pinta y quien los trae.

export interface OrderItem {
  id: string;
  producto: string;
  unidades: number;
  packs?: number | null;
  descripcion?: string | null;
  /**
   * Precio, peso y stock de ESTA sucursal, que los pone la API cruzando el producto
   * con el catálogo traído de Ventra.
   *
   * Son por sucursal a propósito: el mismo producto no vale igual en Camagüey que en
   * Santiago, así que una lista única daría totales falsos en siete de las diez.
   *
   * `precioUnidad` es por unidad de VENTA —el formato o caja—, no por unidad suelta.
   * Por eso `importe` multiplica por los formatos: si multiplicara por las unidades,
   * una caja de 60 saldría sesenta veces su precio.
   *
   * Nulos cuando el producto no está en el catálogo de esa sucursal. No es un fallo:
   * es que Ventra no lo tiene, y hay que verlo en vez de contarlo como cero.
   */
  precioUnidad?: number | null;
  importe?: number | null;
  /** El peso de UNA unidad de venta (el formato/caja), tal como lo da Ventra. */
  pesoKg?: number | null;
  /** El de la línea entera: `pesoKg` por los formatos que llevan. */
  pesoLineaKg?: number | null;
  stock?: number | null;
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
  /**
   * Lo que suma el pedido con los precios de su sucursal, domicilio incluido.
   *
   * `null` si no se pudo calcular ninguna línea. `lineasSinPrecio` dice cuántas
   * faltaron: un total al que le falta un producto es peor que no tener total, porque
   * parece bueno y nadie lo comprueba.
   */
  total?: number | null;
  lineasSinPrecio?: number;
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
  /**
   * Cómo quedó frente a la FACTURA de Ventra: igual | cambiado | sin_factura.
   * Lo escribe delivery, que es quien le pregunta a Ventra. Vacío = sin comprobar.
   */
  facturaEstado?: string | null;
  facturaNumero?: string | null;
  /** Cuándo se reescribió el pedido con lo que decía la factura. Null = vino bien. */
  facturaCorregidoAt?: string | null;
  /** En qué se diferenciaba, en palabras. JSON en texto. */
  facturaDiferencias?: string | null;
  facturaAt?: string | null;
  /**
   * Lo que dice la FACTURA, en JSON, al lado del pedido.
   *
   * El pedido se queda como lo tomó el vendedor. Esto es lo que se llevó el cliente, para
   * poder comparar los dos sin que ninguno pise al otro.
   */
  lineasFactura?: string | null;
  /**
   * En qué punto del REPARTO va: despachado | en_transito | entregado | devuelto |
   * cancelado. Lo escribe delivery. Va aparte de `estado` porque son dos cosas: un pedido
   * puede estar completado aquí y seguir dando vueltas en el camión.
   */
  estadoEntrega?: string | null;
  estadoEntregaAt?: string | null;
  estadoEntregaNota?: string | null;
  /** Lo que la factura cobró por el reparto, si trae la línea de «ENTREGA A DOMICILIO». */
  facturaDomicilio?: number | null;
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
