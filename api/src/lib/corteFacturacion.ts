/**
 * A qué hora se da por cerrado el día de facturación.
 *
 * # Por qué hace falta un corte
 *
 * Un pedido sin factura significa dos cosas distintas según la hora. A las once de la
 * mañana está **esperando** a que lo facturen: es lo normal y no hay nada que mirar. A
 * las ocho de la noche, con la sucursal cerrada, es que **no apareció**: o no se facturó,
 * o se facturó sin pegar el folio en la nota, y ese pedido no va a entrar en ninguna ruta.
 *
 * Sin el corte, las dos se dicen igual —«sin facturar»— y la que importa se pierde entre
 * las que no. Que es justo lo que pasaba.
 *
 * # La hora es de Cuba, no del servidor
 *
 * El VPS corre en UTC. «Las seis y media de la tarde» allí serían las dos, con las
 * sucursales facturando todavía. Se usa `America/Havana` explícitamente.
 *
 * # Tiene que decir lo mismo que el repaso
 *
 * `REPASO_FACTURAS_CRON` corre a las 18:30 y vuelve a mirar el mes entero. Si la pantalla
 * concluyera antes que el repaso, enseñaría «no apareció» de pedidos que el repaso todavía
 * va a encontrar. Los dos números salen de aquí para que no puedan separarse.
 *
 * Hay una copia de esta misma lógica en el front (`order-list.tsx`), porque son dos
 * paquetes distintos. Si cambia la hora, cambia en los dos.
 */

/** 18:30. La misma que `REPASO_FACTURAS_CRON`. */
export const HORA_CORTE = 18.5;

const ZONA = 'America/Havana';

/** El día (AAAA-MM-DD) y la hora decimal en Cuba, no donde esté el servidor. */
export function enCuba(d: Date): { dia: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const v = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '0';
  // `en-CA` con hour12:false da 24 para la medianoche en algunos entornos; 24 y 0 son la
  // misma hora y dejarlo en 24 haría que la medianoche pareciera pasada la de cierre.
  const h = Number(v('hour')) % 24;

  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: h + Number(v('minute')) / 60 };
}

/**
 * ¿Ya cerró el día de ese pedido?
 *
 * Sólo cuando cerró se puede decir que la factura no apareció. Antes, está esperando.
 */
export function yaCerroElDia(fecha: Date | string | null | undefined, ahora = new Date()): boolean {
  if (!fecha) return false;

  const d = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(d.getTime())) return false;

  const pedido = enCuba(d);
  const hoy = enCuba(ahora);

  if (pedido.dia < hoy.dia) return true;   // de un día anterior: cerrado seguro
  if (pedido.dia > hoy.dia) return false;  // del futuro: ni ha empezado

  return hoy.hora >= HORA_CORTE;
}

/**
 * Cómo se llama lo que le pasa a un pedido con la factura, ya con el corte aplicado.
 *
 *  - `facturado`     la factura salió y dice lo mismo que el pedido.
 *  - `cambiado`      salió y dice otra cosa. **También está facturado**: no es una alarma.
 *  - `buscando`      todavía no hay, pero el día no ha cerrado. Normal.
 *  - `no_aparecio`   el día cerró y no hay factura. **Esto es lo que hay que mirar.**
 *  - `sin_completar` el pedido no está completado, así que no toca esperarle factura.
 *  - `sin_cotejar`   el cotejo no ha pasado por él (fuera de su ventana, o recién creado).
 */
export type EstadoFactura =
  | 'facturado'
  | 'cambiado'
  | 'buscando'
  | 'no_aparecio'
  | 'sin_completar'
  | 'sin_cotejar';

/**
 * `completada` es el único estado del que se espera factura.
 *
 * Un pedido en proceso o expirado todavía no se ha despachado, así que no tener factura no
 * es una falta: es lo normal. Decir «buscando factura» ahí llenaba la lista de pedidos
 * expirados marcados como si les faltara algo, y con ese ruido los que de verdad faltan
 * —los completados sin factura— dejaban de verse.
 *
 * Ojo: esto es lo que se ENSEÑA, no lo que se comprueba. El cotejo sigue mirando todos los
 * pedidos, porque facturar no completa: la factura sale a menudo estando el pedido todavía
 * en proceso, y si se dejara de mirarlos no se encontraría nunca.
 */
const SE_LE_ESPERA_FACTURA = (estadoPedido: string | null | undefined) =>
  String(estadoPedido || '').toLowerCase() === 'completada';

export function estadoDeFactura(
  facturaEstado: string | null | undefined,
  fecha: Date | string | null | undefined,
  ahora = new Date(),
  estadoPedido?: string | null,
): EstadoFactura {
  // Si HAY factura se dice, esté el pedido como esté: es un hecho, no una expectativa.
  if (facturaEstado === 'igual') return 'facturado';
  if (facturaEstado === 'cambiado') return 'cambiado';

  if (facturaEstado === 'sin_factura') {
    // `undefined` es «no me han dicho el estado»: se sigue como antes, para no romper a
    // quien llame sin ese dato.
    if (estadoPedido !== undefined && !SE_LE_ESPERA_FACTURA(estadoPedido)) return 'sin_completar';

    return yaCerroElDia(fecha, ahora) ? 'no_aparecio' : 'buscando';
  }

  return 'sin_cotejar';
}
