import { limpiarTodosLosDatos } from "@/stores/crearStoreDatos";

import { SUCURSAL_ACTIVA_KEY } from "./sucursal-activa";

/**
 * Borra TODO lo que era de la sesión anterior.
 *
 * Cerrar sesión solo quitaba el token. Todo lo demás se quedaba, y eso rompió la
 * aplicación en producción el 06/08/2026: se entró como Super Admin enfocado en
 * una sucursal, se cerró sesión y se entró como operadora de otra. El id de la
 * sucursal del admin seguía guardado, así que el navegador lo mandaba en la
 * cabecera de cada petición y el servidor respondía —con razón— "no tienes
 * permiso para operar otra sucursal": **400 en todo**, pantalla en cero y "Error
 * al cargar los pedidos". Y solo le pasaba a quien había usado antes ese
 * navegador con otra cuenta, que es lo que lo hacía tan difícil de creer.
 *
 * También se tiran los datos cacheados. Una navegación normal no recarga la
 * página, así que las listas de la sesión anterior siguen en memoria: sin esto,
 * el siguiente que entra ve por un instante las filas del anterior — de otra
 * sucursal.
 *
 * Se llama al SALIR y también al ENTRAR. Al entrar parece de más, pero es lo que
 * cubre el caso de que la sesión anterior no se cerrara bien: se cerró la
 * pestaña, se fue la corriente, caducó el token. Limpiar en los dos sitios sale
 * gratis y no deja ese hueco.
 */
export function limpiarSesion() {
  if (typeof window !== "undefined") {
    for (const clave of ["auth_token", SUCURSAL_ACTIVA_KEY]) {
      try {
        localStorage.removeItem(clave);
      } catch {
        /* navegador sin almacenamiento: no hay nada que limpiar */
      }
    }
  }

  limpiarTodosLosDatos();
}
