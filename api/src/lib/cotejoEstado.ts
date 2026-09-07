/**
 * Lo que pasó en la última pasada del cotejo, guardado en Redis.
 *
 * # Por qué en Redis y no en la base
 *
 * Es un dato **de la máquina, no del negocio**: vale mientras sea reciente y no le importa
 * a nadie dentro de un mes. Guardarlo en Postgres sería una tabla que crece sola, con su
 * migración y su limpieza, para enseñar una línea en una pantalla.
 *
 * Y sobre todo: lo escribe el **worker** y lo lee la **API**, que son dos procesos
 * distintos. Redis ya está en medio de los dos —con su sentinel— así que el dato cruza sin
 * que la API tenga que preguntarle nada a Ventra ni al worker. Abrir la pantalla no
 * dispara ningún trabajo: sólo lee lo último que el worker dejó dicho.
 *
 * # Por qué caduca
 *
 * Con TTL, si el worker se para el dato **desaparece** en vez de quedarse congelado
 * enseñando la última pasada buena como si fuera de ahora. Una pantalla que dice «no hay
 * dato» es honesta; una que enseña el de hace tres días diciendo que todo va bien, no.
 */
import { getConnection, PREFIX, redisEnabled } from './redis';

export const K_COTEJO_ULTIMA = `${PREFIX}:cotejo:ultima`;

/** Dos horas. La pasada completa corre cada diez minutos: si lleva dos horas sin escribir, está parado. */
const VIDA_S = 2 * 60 * 60;

export interface PasadaSucursal {
  sucursal: string;
  database: string;
  cotejados: number;
  igual: number;
  cambiado: number;
  sinFactura: number;
  error?: string;
}

export interface UltimaPasada {
  /** Cuándo terminó. */
  cuando: string;
  /** Cuánto tardó, en segundos. */
  segundos: number;
  sucursales: PasadaSucursal[];
}

/** Guarda el resultado. Nunca lanza: un fallo aquí no puede tumbar el cotejo. */
export async function guardarUltimaPasada(p: UltimaPasada): Promise<void> {
  if (!redisEnabled()) return;

  try {
    const conn = getConnection();

    if (!conn) return;
    await conn.set(K_COTEJO_ULTIMA, JSON.stringify(p), 'EX', VIDA_S);
  } catch {
    // Que no se pueda guardar el parte no puede parar el cotejo, que es el trabajo de
    // verdad. La pantalla dirá que no hay dato, y eso es correcto.
  }
}

/** Lee el resultado. `null` si no hay Redis, si caducó o si el worker no ha corrido. */
export async function leerUltimaPasada(): Promise<UltimaPasada | null> {
  if (!redisEnabled()) return null;

  try {
    const conn = getConnection();

    if (!conn) return null;

    const crudo = await conn.get(K_COTEJO_ULTIMA);

    return crudo ? (JSON.parse(crudo) as UltimaPasada) : null;
  } catch {
    return null;
  }
}
