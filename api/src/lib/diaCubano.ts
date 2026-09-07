/**
 * Los dos extremos de un día de Cuba, en UTC.
 *
 * # Por qué no vale restar cuatro horas
 *
 * Las fechas se guardan en UTC y el servidor corre en UTC, pero «los pedidos del día 7» son
 * los del día 7 **en Cuba**, que es donde están las sucursales. Cuba va a UTC-4 en verano y
 * a UTC-5 en invierno, así que un desfase escrito a mano parte el día por el sitio
 * equivocado media temporada.
 *
 * # Y por qué no vale «inicio del día más 24 horas»
 *
 * Los dos días del cambio de horario NO duran veinticuatro horas: uno dura veintitrés y el
 * otro veinticinco. Con la resta fija, el 8 de marzo perdía su primera hora y se comía la
 * medianoche del 9; el 1 de noviembre se quedaba sin la última. Comprobado, así fallaba.
 *
 * El final de un día es el **principio del siguiente**, menos un milisegundo. Dicho así
 * sale bien los 365 días sin saberse las fechas del cambio.
 */

const ZONA = 'America/Havana';

/** Qué hora era en Cuba en ese instante, leída como si fuera UTC. Sirve para medir el desfase. */
function comoSiFueraUtc(d: Date): Date {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  // `en-CA` con hour12:false devuelve 24 para la medianoche en algunos entornos.
  const hora = String(Number(v('hour')) % 24).padStart(2, '0');

  return new Date(`${v('year')}-${v('month')}-${v('day')}T${hora}:${v('minute')}:${v('second')}Z`);
}

/** El día `AAAA-MM-DD` que se está viviendo en Cuba en ese instante. */
function diaLocal(d: Date): string {
  return comoSiFueraUtc(d).toISOString().slice(0, 10);
}

/**
 * El instante UTC en que empieza ese día en Cuba.
 *
 * # El día que las 00:00 NO EXISTEN
 *
 * Cuba adelanta el reloj **a medianoche**: el 8 de marzo de 2026, las 23:59:59 del día 7
 * son seguidas por la 01:00:00 del 8. La hora local «2026-03-08 00:00» no ocurre nunca, así
 * que buscarla devuelve el instante equivocado —las 23:00 del día 7— y el día se llevaría
 * una hora que es del día anterior.
 *
 * Ese día el día empieza a la 01:00, que es el primer instante que de verdad cae en él. Por
 * eso, después de calcularlo, se comprueba y se avanza hasta entrar en el día pedido.
 */
export function inicioDelDia(dia: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;

  const base = new Date(`${dia}T00:00:00Z`);

  if (Number.isNaN(base.getTime())) return null;
  // `2026-13-45` pasa el patrón pero no es una fecha: `Date` la corre a otro mes.
  if (base.toISOString().slice(0, 10) !== dia) return null;

  const desfase = (d: Date) => d.getTime() - comoSiFueraUtc(d).getTime();
  // Dos pasadas: la primera usa el desfase del instante equivocado —la medianoche UTC, que
  // en Cuba es la tarde anterior—, y en un día de cambio ése no es el que toca. La segunda
  // lo recalcula ya sobre la hora buena.
  let t = base.getTime() + desfase(base);

  t = base.getTime() + desfase(new Date(t));

  // Y si aun así cae en el día anterior, es que la medianoche de ese día no existe. Se
  // avanza minuto a minuto hasta entrar: el salto es de una hora, así que son 60 vueltas
  // como mucho, y sólo el día del cambio. El tope es para que un dato raro no cuelgue esto.
  for (let i = 0; i < 180 && diaLocal(new Date(t)) < dia; i++) t += 60_000;

  return new Date(t);
}

const siguiente = (dia: string) => {
  const d = new Date(`${dia}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() + 1);

  return d.toISOString().slice(0, 10);
};

/** Del día `AAAA-MM-DD` en Cuba: desde su primer instante hasta el último. */
export function extremosDelDia(dia: string): { desde: Date; hasta: Date } | null {
  const desde = inicioDelDia(dia);
  const finSiguiente = desde && inicioDelDia(siguiente(dia));

  if (!desde || !finSiguiente) return null;

  return { desde, hasta: new Date(finSiguiente.getTime() - 1) };
}

/** El día de hoy en Cuba, en `AAAA-MM-DD`. */
export function hoyEnCuba(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
