import prisma from '../prismaClient';

/**
 * La tasa de cambio USD -> CUP.
 *
 * Viene de la API de Amado, que ya la mantiene para su aplicación. Se trae de ahí en vez
 * de teclearla aquí para que los dos sistemas cobren con la MISMA: si cada uno lleva la
 * suya, un domicilio vale distinto según dónde se mire, y eso sale en la caja.
 *
 * Se guarda con su origen y su fecha. Una tasa sin saber de cuándo es no se puede usar
 * para cobrar: en Cuba se mueve a diario y un importe calculado con la de la semana
 * pasada está mal sin que el número lo diga.
 */

const URL = process.env.TASA_CAMBIO_URL || '';
const CADA_MS = Number(process.env.TASA_CAMBIO_MS || 6 * 60 * 60 * 1000);

/** Cuántas horas puede tener la tasa antes de que deje de ser de fiar. */
export const HORAS_FRESCA = Number(process.env.TASA_CAMBIO_HORAS || 24);

export interface Tasa {
  cupPorUsd: number;
  fuente: string | null;
  traidoAt: Date;
  /** false cuando lleva más de `HORAS_FRESCA` sin actualizarse. */
  fresca: boolean;
}

export async function tasaActual(): Promise<Tasa | null> {
  const t = await prisma.tasaCambio.findUnique({ where: { id: 'actual' } });
  if (!t) return null;
  const horas = (Date.now() - t.traidoAt.getTime()) / 3600000;
  return { cupPorUsd: t.cupPorUsd, fuente: t.fuente, traidoAt: t.traidoAt, fresca: horas <= HORAS_FRESCA };
}

/** La escribe a mano quien administra. Queda marcada como manual, para saberlo. */
export async function ponerTasa(cupPorUsd: number, fuente = 'manual'): Promise<Tasa> {
  const t = await prisma.tasaCambio.upsert({
    where: { id: 'actual' },
    update: { cupPorUsd, fuente, traidoAt: new Date() },
    create: { id: 'actual', cupPorUsd, fuente },
  });
  return { cupPorUsd: t.cupPorUsd, fuente: t.fuente, traidoAt: t.traidoAt, fresca: true };
}

/**
 * La trae de la API de Amado. Acepta varias formas del mismo dato porque todavía no
 * está cerrado cómo la va a devolver: un número suelto, {cup}, {tasa}, {rate}…
 */
export async function traerTasa(): Promise<{ ok: boolean; valor?: number; error?: string }> {
  if (!URL) return { ok: false, error: 'sin TASA_CAMBIO_URL configurada' };
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { ok: false, error: `la API contestó ${r.status}` };
    const b = await r.json().catch(() => null);
    const v = Number(
      typeof b === 'number' ? b
        : b?.cupPorUsd ?? b?.cup_por_usd ?? b?.cup ?? b?.tasa ?? b?.rate ?? b?.valor ?? b?.data?.tasa,
    );
    // Una tasa de 0 o negativa no es una tasa: es un fallo que llegó con forma de dato.
    // Guardarla dejaría todos los importes en CUP a cero sin que nada avisara.
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: `no entendí la respuesta: ${JSON.stringify(b).slice(0, 120)}` };
    }
    await ponerTasa(v, 'amado');
    return { ok: true, valor: v };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Arranca el refresco periódico. Lo llama el worker, no la API. */
export function arrancarTasaCambio(): void {
  if (!URL) {
    console.log('[tasa] sin TASA_CAMBIO_URL: no se trae la tasa (se usa la que se ponga a mano)');
    return;
  }
  const tirar = async () => {
    const r = await traerTasa();
    console.log(r.ok ? `[tasa] USD->CUP = ${r.valor}` : `[tasa] no se pudo traer: ${r.error}`);
  };
  setTimeout(tirar, 20000);
  setInterval(tirar, CADA_MS);
  console.log(`[tasa] refresco cada ${(CADA_MS / 3600000).toFixed(1)} h`);
}
