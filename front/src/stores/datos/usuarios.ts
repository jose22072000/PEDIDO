import { crearStoreDatos } from "../crearStoreDatos";

export interface Usuario {
  id: string;
  username: string;
  rolId?: string | null;
  sucursalId?: string | null;
  rol?: { nombre: string } | null;
  sucursal?: { nombre: string } | null;
  createdAt: string;
}

/** Lo que devuelve /users: una PAGINA, no la lista entera. */
export interface RespuestaUsuarios {
  data: Usuario[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Store de usuarios. Escucha "usuario" y "vendedor": un gestor es un usuario
 * enlazado a vendedores, y al cambiar esos enlaces la lista cambia.
 */
export const { useStore: useUsuariosStore, usar: usarUsuarios } =
  crearStoreDatos<RespuestaUsuarios>(["usuario", "vendedor"]);
