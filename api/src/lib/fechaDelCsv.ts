/**
 * Las fechas del CSV, escritas como las escriba quien lo mande.
 *
 * # El fallo que arregla
 *
 * Se leían así: `new Date(texto + 'T12:00:00')`. Eso sólo entiende el formato ISO
 * (`2026-09-01`). En cuanto alguien abre el archivo en Excel y lo guarda, Excel reescribe
 * las fechas con el formato de su idioma —`9/1/2026`— y entonces sale `Invalid Date`, la
 * fila revienta al guardarse y el pedido NO ENTRA.
 *
 * Lo peor no era eso: era que la pantalla decía «subido exitosamente» igual, porque el
 * fallo de una fila no hace fallar la importación. El pedido no aparecía por ningún lado y
 * no había nada que mirar.
 *
 * # Por qué no se adivina
 *
 * `9/1/2026` puede ser el 9 de enero o el 1 de septiembre, y no hay forma de saberlo
 * mirando esa fila sola. Elegir mal no da un error: archiva el pedido con ocho meses de
 * diferencia, donde nadie lo va a buscar. O sea, exactamente el mismo síntoma que se
 * viene a arreglar.
 *
 * Así que se mira el ARCHIVO ENTERO antes de decidir:
 *
 *   1. Si alguna fecha tiene un número mayor que 12 en la primera posición —`25/08/2026`—
 *      sólo puede ser día/mes: eso fija la convención para todas las demás.
 *   2. Si lo tiene en la segunda —`8/25/2026`— es mes/día, y también queda fijada.
 *   3. Si NINGUNA lo aclara, no se inventa: esas filas se rechazan diciendo las dos
 *      lecturas posibles y cómo guardar el archivo para que no pase.
 */

/** Cómo lee las fechas este archivo. */
export type Convencion = 'iso' | 'dia-mes' | 'mes-dia' | 'ambigua';

const CON_BARRAS = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/;
const ISO = /^\s*(\d{4})-(\d{2})-(\d{2})/;

/**
 * Qué convención usa un conjunto de fechas.
 *
 * Se le pasan TODAS las del archivo: basta con que una sola sea inequívoca para saber
 * leer el resto.
 */
export function convencionDeFechas(textos: Array<unknown>): Convencion {
  let hayBarras = false;

  for (const t of textos) {
    const s = typeof t === 'string' ? t : '';

    if (!s.trim()) continue;
    if (ISO.test(s)) continue;

    const m = s.match(CON_BARRAS);

    if (!m) continue;
    hayBarras = true;

    const primero = Number(m[1]);
    const segundo = Number(m[2]);

    if (primero > 12) return 'dia-mes';
    if (segundo > 12) return 'mes-dia';
  }

  return hayBarras ? 'ambigua' : 'iso';
}

export interface FechaLeida {
  fecha: Date | null;
  /** Por qué no se pudo leer. Vacío cuando salió bien o cuando no venía nada. */
  error?: string;
}

/**
 * Lee una fecha del CSV. Devuelve `null` sin error cuando la celda viene vacía.
 *
 * El mediodía es a propósito: con la hora a cero, un huso horario al oeste mueve la fecha
 * al día anterior y el pedido aparece un día antes de lo que dice el archivo.
 */
export function leerFecha(valor: unknown, convencion: Convencion): FechaLeida {
  const s = typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();

  if (!s) return { fecha: null };

  if (ISO.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);

    return Number.isNaN(d.getTime())
      ? { fecha: null, error: `la fecha «${s}» no es una fecha válida` }
      : { fecha: d };
  }

  const m = s.match(CON_BARRAS);

  if (!m) return { fecha: null, error: `no se entiende la fecha «${s}» (se espera 2026-09-01)` };

  const a = Number(m[1]);
  const b = Number(m[2]);
  const anio = Number(m[3]);

  let dia: number;
  let mes: number;

  if (a > 12) {
    dia = a;
    mes = b;
  } else if (b > 12) {
    dia = b;
    mes = a;
  } else if (convencion === 'dia-mes') {
    dia = a;
    mes = b;
  } else if (convencion === 'mes-dia') {
    dia = b;
    mes = a;
  } else {
    // Ambigua de verdad: se dice, y se dicen las dos lecturas. Adivinar aquí archiva el
    // pedido en otro mes y nadie lo encuentra.
    return {
      fecha: null,
      error:
        `la fecha «${s}» puede ser ${a}/${b} o ${b}/${a} y no hay forma de saberlo. ` +
        `Guarda el archivo con las fechas como 2026-09-01.`,
    };
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return { fecha: null, error: `la fecha «${s}» no existe` };
  }

  const d = new Date(`${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T12:00:00`);

  return Number.isNaN(d.getTime()) ? { fecha: null, error: `la fecha «${s}» no existe` } : { fecha: d };
}
