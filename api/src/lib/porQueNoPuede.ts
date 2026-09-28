/**
 * Por qué se le dice que no a alguien: la información de verdad, no «no tienes permiso».
 *
 * # El caso que lo pidió
 *
 * El 28/09/2026 una OPERADORA no pudo completar un pedido y la pantalla dijo «Tu rol no
 * puede completar pedidos. Los completa el Operador o quien lleva la sucursal». O sea: le
 * decía que no y en la misma frase le decía que su rol sí puede. Comprobado en la base,
 * su cuenta es Operador y con ella el completar funciona.
 *
 * Lo que había pasado lo dijo Jose y era lo correcto: **antes había entrado otra persona
 * en ese navegador**. La sesión anterior no se borraba entera al salir, así que quedaba la
 * identidad del anterior y la aplicación operaba con SU rol. Un mensaje que habla de «tu
 * rol» en esa situación manda a buscar donde no es: el rol de ella estaba bien.
 *
 * # Qué dice ahora
 *
 * **Con qué USUARIO está abierta la sesión**, que es el dato que lo resuelve de un vistazo
 * y sin ayuda de nadie: si la persona se llama Liliani y la pantalla dice que la sesión es
 * de otro, ya está todo dicho y la salida es cerrar sesión y volver a entrar. El rol va
 * detrás, como dato de apoyo.
 *
 * No se filtra nada: el nombre de usuario con el que uno tiene la sesión abierta lo tiene
 * delante en la propia pantalla.
 *
 * Y si el token no trae nada, se dice eso mismo —sesión rota, vuelve a entrar— en vez de
 * hablar de permisos, porque no es un problema de permisos.
 */
export function porQueNoPuede(
  accion: string,
  rol: string | undefined | null,
  usuario?: string | null,
): string {
  const volverAEntrar = 'cierra sesión y vuelve a entrar con tu usuario';

  if (!rol && !usuario) {
    return `Esta sesión no trae usuario ni rol, así que no se puede comprobar si puedes ${accion}. Cierra sesión y vuelve a entrar con tu usuario.`;
  }

  if (usuario) {
    return (
      `La sesión de este navegador está abierta como «${usuario}»` +
      (rol ? `, que es ${rol}` : '') +
      `, y no puede ${accion}. Si ése no eres tú, es la sesión de quien usó antes este ` +
      `navegador: ${volverAEntrar}.`
    );
  }

  return `Esta sesión entró como ${rol} y ese rol no puede ${accion}. Cierra sesión y vuelve a entrar con tu usuario.`;
}
