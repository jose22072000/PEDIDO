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
  /** Lo que trae Prisma con `_count`. La regla no lo usa; se enseña al contestar. */
  _count?: { pedidos: number };
}

// Un objeto plano y no un union discriminado: este proyecto compila sin
// `strictNullChecks` y ahí el union no estrecha, así que `decision.activos` daría error
// de tipos en la rama que sí lo tiene.
export interface DecisionBorrado {
  permitido: boolean;
  /** Los que lo impiden. Vacío cuando se permite. */
  activos: VendedorACargo[];
  /** Los que se quedan sin gestor, conservando su sucursal. Vacío cuando no se permite. */
  aLiberar: VendedorACargo[];
}

/**
 * # La regla
 *
 * **Bloquea sólo si alguno sigue ACTIVO.** Un vendedor activo sin gestor es el fallo de
 * Holguín: la ingesta le pone la sucursal de su gestor, y sin gestor se la deja en
 * nulo. Queda «sin asignar» y todo lo que suba a partir de ahí desaparece de la vista.
 *
 * **Uno de baja no tiene ese problema**: su CSV ya no llega —la ingesta lo rechaza— así
 * que nadie le va a tocar la sucursal. Puede quedarse sin usuario tranquilamente.
 *
 * Los de baja **no se borran ni se vacían**: pierden el gestor y **conservan su
 * sucursal**, con todo su histórico. Borrar al usuario no puede llevarse por delante lo
 * que ya se recogió: hace falta para hacer seguimiento aunque esa persona ya no
 * trabaje.
 */
export function decidirBorrado(vendedores: VendedorACargo[]): DecisionBorrado {
  const activos = vendedores.filter((v) => v.activo);

  return activos.length
    ? { permitido: false, activos, aLiberar: [] }
    : { permitido: true, activos: [], aLiberar: vendedores };
}
