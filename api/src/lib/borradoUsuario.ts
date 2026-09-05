/**
 * Qué pasa con los vendedores de un usuario cuando se le borra.
 *
 * Va aparte de la ruta para poder probarlo: equivocarse aquí no da un error, da un
 * vendedor «sin asignar» cuyos pedidos desaparecen de los informes sin que nadie lo
 * note hasta el cierre de mes. Pasó en Holguín el 08/08/2026.
 */

export interface VendedorACargo {
  id: string;
  nombre: string;
  codigo: string | null;
  activo: boolean;
  /** Cuántos pedidos lleva. Es lo que decide si hay histórico que proteger. */
  _count?: { pedidos: number };
}

// Un objeto plano y no un union discriminado: este proyecto compila sin
// `strictNullChecks` y ahí el union no estrecha, así que `decision.activos` daría error
// de tipos en la rama que sí lo tiene.
export interface DecisionBorrado {
  permitido: boolean;
  /** Los que lo impiden. Vacío cuando se permite. */
  activos: VendedorACargo[];
  /**
   * Los que se van CON el usuario. Son los que no tienen ni un pedido: fichas creadas a
   * mano por equivocación, sin nada que conservar. Dejarlas sueltas obliga a ir a
   * borrarlas una a una a otra pantalla, y mientras tanto ensucian las listas.
   */
  aBorrar: VendedorACargo[];
  /**
   * Los que se QUEDAN, sin gestor y con su sucursal. Son los que llevan pedidos: ahí hay
   * histórico que hace falta para seguir mirando lo que vendió alguien que ya no está.
   */
  aLiberar: VendedorACargo[];
}

/**
 * # La regla
 *
 * **Bloquea sólo si alguno está ACTIVO Y TIENE PEDIDOS.** Ése es el caso que hay que
 * proteger: un vendedor activo sin gestor es el fallo de Holguín —la ingesta le pone la
 * sucursal de su gestor, y sin gestor se la deja en nulo— así que queda «sin asignar» y
 * todo lo que suba a partir de ahí desaparece de la vista. Con pedidos detrás, eso es
 * esconder histórico.
 *
 * **Uno de baja no tiene ese problema**: su CSV ya no llega —la ingesta lo rechaza— así
 * que nadie le va a tocar la sucursal. Puede quedarse sin usuario tranquilamente.
 *
 * **Y uno activo SIN NINGÚN PEDIDO tampoco bloquea.** No hay histórico que esconder:
 * son los creados a mano por equivocación —un nombre mal escrito, uno duplicado, uno de
 * prueba— y hoy son 27 de 101. Obligar a reasignarlos antes de borrar a su usuario es
 * pedir un trámite para mover una ficha vacía.
 *
 * # Y qué pasa con los que no bloquean
 *
 * **Con pedidos**: se quedan. Pierden el gestor y **conservan su sucursal**, con todo su
 * histórico. Borrar al usuario no puede llevarse por delante lo que ya se recogió: hace
 * falta para seguir mirando lo que vendió alguien que ya no trabaja.
 *
 * **Sin ningún pedido**: se van con el usuario. No hay nada que conservar, y dejarlos
 * sueltos obliga a ir a borrarlos uno a uno a otra pantalla. Si alguno volviera a hacer
 * falta, el CSV lo crea otra vez.
 */
export function decidirBorrado(vendedores: VendedorACargo[]): DecisionBorrado {
  const activos = vendedores.filter((v) => v.activo && (v._count?.pedidos ?? 0) > 0);

  if (activos.length) return { permitido: false, activos, aBorrar: [], aLiberar: [] };

  const conPedidos = (v: VendedorACargo) => (v._count?.pedidos ?? 0) > 0;

  return {
    permitido: true,
    activos: [],
    aBorrar: vendedores.filter((v) => !conPedidos(v)),
    aLiberar: vendedores.filter(conPedidos),
  };
}
