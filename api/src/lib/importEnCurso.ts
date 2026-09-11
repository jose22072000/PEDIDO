import { getConnection, PREFIX, redisEnabled } from './redis';

/**
 * Las importaciones que se están haciendo AHORA en línea, para que se vean.
 *
 * # Por qué hace falta
 *
 * Hay dos caminos para meter pedidos y sólo uno se veía. La pantalla, con archivos
 * grandes, encola el trabajo y la cola se puede mirar. Pero **la ingesta automática de
 * n8n importa en línea** (`?sync=1`) porque necesita el resultado en la misma respuesta
 * para mover el CSV a Procesados o a Errores. Ese camino no dejaba rastro ninguno: los
 * archivos se movían en el Drive y en la pantalla no cambiaba nada, así que los operadores
 * seguían sin saber si estaban entrando datos.
 *
 * # Por qué en Redis y no en memoria
 *
 * La API puede tener más de una réplica y quien mira la pantalla no cae necesariamente en
 * la misma que está importando. En Redis lo ve cualquiera.
 *
 * # El TTL es la red de seguridad
 *
 * Cada aviso renueva la llave con 90 segundos. Si el proceso se muere a mitad, la llave
 * caduca sola y la barra deja de enseñar un trabajo fantasma. Sin eso, un reinicio a media
 * importación dejaría «importando…» para siempre.
 */
const TTL = 90;

export type EnCurso = {
  id: string;
  archivo: string | null;
  sucursalId: string | null;
  origen: 'n8n' | 'pantalla';
  filas: number;
  hechos: number;
  creados: number;
  actualizados: number;
  fallidos: number;
  desdeAt: number;
};

const llave = (id: string) => `${PREFIX}:import:encurso:${id}`;

export async function anotarEnCurso(v: EnCurso): Promise<void> {
  if (!redisEnabled()) return;

  try {
    await getConnection()?.set(llave(v.id), JSON.stringify(v), 'EX', TTL);
  } catch {
    // Es información, no el trabajo: si Redis falla, la importación sigue igual.
  }
}

export async function borrarEnCurso(id: string): Promise<void> {
  if (!redisEnabled()) return;

  try {
    await getConnection()?.del(llave(id));
  } catch {
    /* caduca sola por el TTL */
  }
}

export async function leerEnCurso(): Promise<EnCurso[]> {
  if (!redisEnabled()) return [];

  try {
    const c = getConnection();

    if (!c) return [];

    // SCAN y no KEYS: KEYS bloquea el Redis entero, y este es el mismo Redis que usan
    // las colas y las sesiones.
    const encontradas: string[] = [];
    let cursor = '0';

    do {
      const [siguiente, lote] = await c.scan(cursor, 'MATCH', llave('*'), 'COUNT', 100);

      cursor = siguiente;
      encontradas.push(...lote);
    } while (cursor !== '0' && encontradas.length < 200);

    if (encontradas.length === 0) return [];

    const valores = await c.mget(...encontradas);

    return valores
      .map((v) => {
        try {
          return v ? (JSON.parse(v) as EnCurso) : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is EnCurso => v !== null);
  } catch {
    return [];
  }
}


/**
 * Las últimas importaciones TERMINADAS, para que se vean aunque duren un suspiro.
 *
 * # Por qué hace falta además de las «en curso»
 *
 * Los pedidos no entran de golpe: entran poco a poco, en tandas pequeñas. Una tanda de
 * cuarenta filas se importa en menos de un segundo, así que la llave de «en curso» nace y
 * muere entre dos refrescos de la pantalla y **no se ve nunca**. La barra quedaba igual de
 * muda que antes justo en el caso corriente.
 *
 * Guardando lo que acaba de terminar, la barra puede decir «entró pedidos_stg.csv hace dos
 * minutos, 45 pedidos», que es exactamente la respuesta que busca quien pregunta.
 *
 * Es una lista recortada a 30 y con dos horas de vida: no es un histórico —para eso está
 * la base—, es «lo que ha pasado hace un rato».
 */
const K_HECHAS = `${PREFIX}:import:hechas`;
const TOPE = 30;
const VIDA = 2 * 60 * 60;

export type Hecha = {
  archivo: string | null;
  sucursalId: string | null;
  origen: 'n8n' | 'pantalla';
  filas: number;
  creados: number;
  actualizados: number;
  fallidos: number;
  /** Cuánto tardó, en milisegundos. Es lo que deja ver si algo va lento y desde cuándo. */
  ms: number;
  at: number;
};

export async function anotarHecha(v: Hecha): Promise<void> {
  if (!redisEnabled()) return;

  try {
    const c = getConnection();

    if (!c) return;

    await c.lpush(K_HECHAS, JSON.stringify(v));
    await c.ltrim(K_HECHAS, 0, TOPE - 1);
    await c.expire(K_HECHAS, VIDA);
  } catch {
    /* información, no el trabajo */
  }
}

export async function leerHechas(desdeMs: number): Promise<Hecha[]> {
  if (!redisEnabled()) return [];

  try {
    const crudas = (await getConnection()?.lrange(K_HECHAS, 0, TOPE - 1)) ?? [];

    return crudas
      .map((v) => {
        try {
          return JSON.parse(v) as Hecha;
        } catch {
          return null;
        }
      })
      .filter((v): v is Hecha => v !== null && v.at >= desdeMs);
  } catch {
    return [];
  }
}
