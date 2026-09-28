/**
 * Por qué se le dice que no a alguien, con lo que hace falta para arreglarlo.
 *
 * # El caso que lo pidió
 *
 * El 28/09/2026 una OPERADORA no pudo completar un pedido y la pantalla dijo «Tu rol no
 * puede completar pedidos. Los completa el Operador o quien lleva la sucursal». O sea: le
 * decía que no y en la misma frase le decía que su rol sí puede. Comprobado en la base,
 * su cuenta era Operador y con ella el completar funciona.
 *
 * Lo que falla en esos casos no es el permiso: es que **el rol viaja dentro del token de
 * la sesión**, y el token se firma al entrar. A quien le cambian el rol sigue llevando el
 * viejo hasta que vuelve a entrar, y entonces la aplicación le niega cosas que su cuenta
 * sí puede hacer. Desde fuera es indistinguible de un permiso mal puesto.
 *
 * # Qué cambia
 *
 * El mensaje dice **qué rol venía en la sesión**, que es el dato que resuelve la duda de
 * un vistazo —incluso en una foto de la pantalla, que es como llegan estas cosas—: si la
 * persona es Operadora y ahí pone GESTOR, ya está dicho todo y la salida es volver a
 * entrar. Y si el token no trae rol ninguno, se dice eso mismo en vez de hablar de
 * permisos, porque no es un problema de permisos.
 *
 * No se filtra nada que el usuario no sepa: es su propio rol.
 */
export function porQueNoPuede(accion: string, rol: string | undefined | null): string {
  if (!rol) {
    return (
      `Tu sesión no trae el rol, así que no se puede comprobar si puedes ${accion}. ` +
      'Cierra sesión y vuelve a entrar; si sigue igual, avisa.'
    );
  }

  return (
    `Tu sesión entró como ${rol} y ese rol no puede ${accion}. ` +
    'Si tu cuenta ya no es ésa, cierra sesión y vuelve a entrar: el rol se guarda al entrar ' +
    'y el tuyo cambió después.'
  );
}
