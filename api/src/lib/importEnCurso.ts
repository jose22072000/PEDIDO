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
