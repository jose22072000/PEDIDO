/**
 * Las fechas que llegan por la URL (`?fechaDesde=2026-08-06`).
 *
 * Existe por un fallo real de producción del 06/08/2026: tres respuestas 500 en
 * `GET /orders` con
 *
 *     Invalid value for argument `gte`: Provided Date object is invalid.
 *
 * El campo de fecha del navegador (`<input type="date">`) deja teclear un año de
 * más de cuatro cifras. Al escribir el año a mano se puede quedar un momento en
 * `202026-08-06`, que NO es una fecha ISO válida: `new Date(...)` devuelve
 * `Invalid Date`, Prisma la rechaza y se cae la consulta ENTERA. Quien lo sufre
 * no ve "fecha mal escrita": ve la lista de pedidos en blanco.
 *
 * El mismo agujero estaba en los informes, donde `"basura".split('-')` daba
 * `NaN` y construía otra `Invalid Date` sin avisar.
 *
 * Se comprueba el FORMATO y también que la fecha EXISTA. Solo el formato no
 * basta: `2026-02-31` lo cumple, y `new Date(2026, 1, 31)` no falla — se
 * desborda calladamente al 3 de marzo. Un filtro que devuelve los días
 * equivocados sin decir nada es peor que uno que da error.
 */

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface FechaConsulta {
  /** La fecha ya construida, o null si el valor venía vacío. */
  fecha: Date | null;
  /** Mensaje para el usuario si el valor no sirve. */
  error?: string;
}

/**
 * @param valor  lo que llegó por la URL
 * @param campo  cómo se llama el campo, para poder decirlo en el error
 * @param finDelDia  true = 23:59:59.999 (para el límite "hasta"), false = 00:00
 *
 * Vacío o ausente NO es un error: significa "sin filtro".
 */
export function parsearFechaConsulta(
  valor: unknown,
  campo: string,
  finDelDia = false,
): FechaConsulta {
  if (valor === undefined || valor === null || valor === '') return { fecha: null };

  if (typeof valor !== 'string') {
    return { fecha: null, error: `La fecha "${campo}" no es válida.` };
  }

  const m = FORMATO.exec(valor.trim());
  if (!m) {
    return {
      fecha: null,
      error: `La fecha "${campo}" tiene que ser del tipo AAAA-MM-DD (recibido: "${valor}").`,
    };
  }

  const [, aa, mm, dd] = m;
  const anio = Number(aa);
  const mes = Number(mm);
  const dia = Number(dd);

  const fecha = finDelDia
    ? new Date(Date.UTC(anio, mes - 1, dia, 23, 59, 59, 999))
    : new Date(Date.UTC(anio, mes - 1, dia, 0, 0, 0, 0));

  // Que la fecha EXISTA: si el día se desbordó al mes siguiente, lo que se
  // tecleó no era una fecha real. Se comprueba comparando lo que se pidió con lo
  // que salió, que es lo único que detecta el desbordamiento.
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return { fecha: null, error: `La fecha "${campo}" no existe (recibido: "${valor}").` };
  }

  return { fecha };
}
