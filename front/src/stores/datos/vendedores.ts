import { crearStoreDatos } from "../crearStoreDatos";

export interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
  createdAt: string;
  // Enlace con su gestor. gestorId null = "Sin asignar": sus pedidos quedan
  // ocultos en la vista de pedidos hasta que se le enlace un gestor.
  gestorId: string | null;
  activo: boolean;
  gestor?: { id: string; username: string } | null;
  sucursal?: { nombre: string; codigo: string | null } | null;
  _count?: { pedidos: number };
}

/**
 * Store de vendedores. Escucha "vendedor" y también "usuario": el gestor de un
 * vendedor es un usuario, así que al cambiar usuarios la lista se queda vieja.
 */
export const { useStore: useVendedoresStore, usar: usarVendedores } =
  crearStoreDatos<Vendedor[]>(["vendedor", "usuario"]);
