import { crearStoreDatos } from "../crearStoreDatos";

export interface Usuario {
  id: string;
  username: string;
  rolId?: string | null;
  sucursalId?: string | null;
  rol?: { nombre: string } | null;
  sucursal?: { nombre: string } | null;
}

/**
 * Store de usuarios. Escucha "usuario" y "vendedor": un gestor es un usuario
 * enlazado a vendedores, y al cambiar esos enlaces la lista cambia.
 */
export const { useStore: useUsuariosStore, usar: usarUsuarios } =
  crearStoreDatos<Usuario[]>(["usuario", "vendedor"]);
