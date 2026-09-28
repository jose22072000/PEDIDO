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
 *
 * # Por qué se borra TODO y no una lista de claves
 *
 * Porque la lista se quedó corta y volvió a pasar. Borraba `auth_token` y la sucursal
 * enfocada, y **el usuario con su rol se guardaba en otra clave** —`auth-storage`, la del
 * store— que nadie tocaba. El 28/09/2026 una operadora no pudo completar un pedido: la
 * pantalla le dijo «tu rol no puede», su cuenta era Operador y sí podía. Había entrado
 * antes otra persona en ese navegador. Jose: «cuando tú das cerrar sesión tienes que
 * borrar todo para que esto no ocurra».
 *
 * Una lista de claves hay que acordarse de ampliarla cada vez que alguien guarda algo
 * nuevo, y nadie se acuerda — ya van dos veces. Se vacía el almacenamiento entero: lo que
 * se pierde son preferencias de este navegador (el tema, la moneda), que se vuelven a
 * poner en un clic; lo que se evita es que la identidad de una persona se quede pegada a
 * la pantalla de otra.
 */
export function limpiarSesion() {
  if (typeof window !== "undefined") {
    /*
     * Primero las claves de la sesión, una a una.
     *
     * `clear()` puede fallar entero —modo privado, almacenamiento bloqueado por política,
     * la cuota— y si falla la primera línea, lo demás no se ejecuta. Quitando estas dos
     * antes, aunque el borrado general se caiga, el token y la sucursal ya no están: es
     * lo mínimo que no puede quedarse.
     */
    for (const clave of ["auth_token", SUCURSAL_ACTIVA_KEY, "auth-storage"]) {
      try {
        localStorage.removeItem(clave);
      } catch {
        /* navegador sin almacenamiento: no hay nada que limpiar */
      }
    }

    // Y ahora todo lo demás, sin lista que mantener.
    for (const almacen of [() => localStorage, () => sessionStorage]) {
      try {
        almacen().clear();
      } catch {
        /* idem */
      }
    }
  }

  limpiarTodosLosDatos();
}
