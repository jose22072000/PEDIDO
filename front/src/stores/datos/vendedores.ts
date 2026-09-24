import { crearStoreDatos } from "../crearStoreDatos";

export interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
  createdAt: string;
  // Enlace con su usuario de la app, si lo tiene. Los que no usan la app van sin
  // gestor y con sucursal: lo que deja los pedidos ocultos es NO tener sucursal.
  gestorId: string | null;
  sucursalId?: string | null;
  activo: boolean;
  /** Quien lo dio de baja y cuando. Vacios si esta de alta. */
  bajaPor?: string | null;
  bajaEn?: string | null;
  gestor?: { id: string; username: string } | null;
  sucursal?: { id: string; nombre: string; codigo: string | null } | null;
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
export interface Sucursal {
  id: string;
  nombre: string;
  codigo: string | null;
}

export interface RespuestaVendedores {
  vendedores: Vendedor[];
  gestores: Gestor[];
  /** Las sucursales en las que quien mira puede poner un vendedor. */
  sucursales?: Sucursal[];
  sinAsignar: number;
}

/**
 * Store de vendedores. Escucha "vendedor" y también "usuario": el gestor de un
 * vendedor es un usuario, así que al cambiar usuarios la lista se queda vieja.
 */
export const { useStore: useVendedoresStore, usar: usarVendedores } =
  crearStoreDatos<RespuestaVendedores>(["vendedor", "usuario"]);
