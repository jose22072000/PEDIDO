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
  /** Quien lo dio de baja y cuando. Vacios si esta de alta. */
  bajaPor?: string | null;
  bajaEn?: string | null;
  gestor?: { id: string; username: string } | null;
  sucursal?: { nombre: string; codigo: string | null } | null;
  _count?: { pedidos: number };
}

export interface Gestor {
  id: string;
  username: string;
  sucursalId: string | null;
  sucursal?: { nombre: string; codigo: string | null } | null;
}

/**
 * Lo que devuelve /vendedores/gestores: la lista, los gestores a los que se
 * pueden enlazar y cuántos quedan sin asignar. Viene todo en una sola
 * respuesta, así que se cachea junto.
 */
export interface RespuestaVendedores {
  vendedores: Vendedor[];
  gestores: Gestor[];
  sinAsignar: number;
}

/**
 * Store de vendedores. Escucha "vendedor" y también "usuario": el gestor de un
 * vendedor es un usuario, así que al cambiar usuarios la lista se queda vieja.
 */
export const { useStore: useVendedoresStore, usar: usarVendedores } =
  crearStoreDatos<RespuestaVendedores>(["vendedor", "usuario"]);
