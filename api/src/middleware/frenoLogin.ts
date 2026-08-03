/**
 * Freno de fuerza bruta en el login, POR USUARIO — nunca por IP.
 *
 * Por qué no por IP: una sucursal entera sale por UNA sola IP pública (CGNAT de
 * Starlink). El servidor viejo tenía nginx con 10 peticiones por minuto por IP en
 * el login, y con tres personas entrando a las 8am la sucursal se bloqueaba sola.
 * Por eso el rate limit por IP se quitó a propósito y no se vuelve a poner.
 *
 * Frenando por NOMBRE DE USUARIO el problema desaparece: quien está siendo
 * atacado es una cuenta concreta, así que solo se frena esa. Los compañeros de la
 * misma oficina entran con normalidad aunque compartan IP.
 *
 * El retardo crece exponencialmente y se corta a 15 minutos. Un humano que se
 * equivoca cuatro veces no lo nota; un atacante pasa de ~15.000 intentos en cinco
 * minutos (lo que permitía el rate limit de Traefik) a unas decenas por hora.
 *
 * En memoria a propósito: hay UNA réplica del api, y meter Redis en el camino del
 * login significaría que nadie puede entrar si Redis se cae.
 */

const TOLERANCIA = 5; // fallos gratis antes de empezar a frenar
const BASE_MS = 2_000; // primer castigo
const TOPE_MS = 15 * 60_000; // 15 min
const OLVIDO_MS = 60 * 60_000; // se olvida el historial tras una hora sin intentos

interface Intento {
  fallos: number;
  bloqueadoHasta: number;
  visto: number;
}

const intentos = new Map<string, Intento>();

/** Se limpia de vez en cuando para que el mapa no crezca sin fin. */
function limpiar(ahora: number) {
  if (intentos.size < 500) return;
  for (const [k, v] of intentos) {
    if (ahora - v.visto > OLVIDO_MS) intentos.delete(k);
  }
}

const clave = (usuario: string) => usuario.trim().toLowerCase();

/**
 * @returns milisegundos que faltan para poder reintentar, o 0 si puede pasar.
 */
export function esperaPendiente(usuario: string): number {
  const e = intentos.get(clave(usuario));

  if (!e) return 0;
  const falta = e.bloqueadoHasta - Date.now();

  return falta > 0 ? falta : 0;
}

export function apuntarFallo(usuario: string): void {
  const ahora = Date.now();
  const k = clave(usuario);
  const e = intentos.get(k) ?? { fallos: 0, bloqueadoHasta: 0, visto: ahora };

  // Si hace más de una hora del último intento, se empieza de cero: no se castiga
  // a quien se equivocó una vez la semana pasada.
  if (ahora - e.visto > OLVIDO_MS) e.fallos = 0;

  e.fallos++;
  e.visto = ahora;
  if (e.fallos > TOLERANCIA) {
    const castigo = Math.min(BASE_MS * 2 ** (e.fallos - TOLERANCIA - 1), TOPE_MS);

    e.bloqueadoHasta = ahora + castigo;
  }
  intentos.set(k, e);
  limpiar(ahora);
}

/** Entró bien: se le borra el historial. */
export function olvidarFallos(usuario: string): void {
  intentos.delete(clave(usuario));
}
