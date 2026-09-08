/**
 * Quién manda en TODA la empresa, no en una sucursal.
 *
 * # Por qué es una función y no una comparación suelta
 *
 * `DESARROLLADOR` está por encima de Super Admin —es quien mantiene la plataforma por
 * dentro— y en el login único está declarado así: «puede todo lo del Super Admin y además
 * el módulo de Avisos». Pero las pantallas comparaban con la cadena `"super admin"` a
 * mano, en cinco sitios distintos, así que con ese rol **no se veía nada**: las rutas
 * mandaban a /unauthorized y los botones no salían.
 *
 * Un rol que no está en una lista no da error. Da cero, con 200 y sin una traza, que desde
 * dentro es indistinguible de «esta cuenta no tiene datos».
 *
 * Escrito una vez y usado en todas partes, el día que se añada otro rol de plataforma se
 * toca UN sitio en vez de buscar cinco comparaciones sueltas.
 */
const GLOBALES = new Set(["super admin", "desarrollador"]);

export function esRolGlobal(rol?: string | null): boolean {
  return GLOBALES.has(String(rol || "").trim().toLowerCase());
}

/** Los nombres tal cual, para pasarlos a `allowedRoles` de las rutas. */
export const ROLES_GLOBALES = ["Super Admin", "Desarrollador"];
