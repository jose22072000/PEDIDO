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

/**
 * La API de tasas de delivery-apk, por la RED INTERNA del servidor.
 *
 * `http://delivery_api_apk` y no su dominio público a propósito. Los dos contenedores
 * están en la misma máquina, así que salir a internet para volver a entrar sería dar la
 * vuelta al mundo — y ahora mismo ni siquiera se puede: su dominio público no negocia
 * TLS (el certificado de Cloudflare no cubre dos niveles de subdominio) y por
 * api.procovar.cloud contesta 526. Por dentro no hay certificado que valga ni salida a
 * internet de la que depender.
 */
const URL = process.env.TASA_CAMBIO_URL || 'http://delivery_api_apk/api/v1/tasas/consulta';

/** El token que pide en la cabecera X-API-Token. Sin él contesta 401. */
const TOKEN = process.env.TASA_CAMBIO_TOKEN || '';

/**
 * Su tasa es POR SUCURSAL, así que hay que decirle cuál.
 *
 * Se usa el código de la sucursal de esta instalación de PEDIDO. Si no hay ninguna
 * configurada —el super admin viendo todas— se cae a HAB, que es donde está el volumen.
 */
const SUCURSAL = process.env.TASA_CAMBIO_SUCURSAL || process.env.SUCURSAL_CODIGO || 'HAB';
// Cada 12 h, igual que el catálogo. La tasa cambia a diario, así que mirarla dos veces
// al día la deja con medio día de antigüedad como peor caso — y Amado avisa cuando se
// mueve, así que esto es la red por si el aviso no llega.
const CADA_MS = Number(process.env.TASA_CAMBIO_MS || 12 * 60 * 60 * 1000);

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
  if (!TOKEN) return { ok: false, error: 'sin TASA_CAMBIO_TOKEN configurado' };
  try {
    const u = `${URL}?codigoSucursal=${encodeURIComponent(SUCURSAL)}`;
    const r = await fetch(u, {
      // En la cabecera y no en la URL: un token en el query string queda escrito en los
      // logs de todo lo que haya por el camino, y ahí ya no se borra.
      headers: { 'X-API-Token': TOKEN, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      // Los suyos, dichos como se entienden. Un 404 aquí casi siempre es que esa
      // sucursal no tiene tasa cargada todavía, no que la API esté mal.
      const porQue: Record<number, string> = {
        401: 'token rechazado (X-API-Token)',
        404: `sin tasa vigente para la sucursal ${SUCURSAL}`,
        422: 'falta codigoSucursal o la fecha va mal',
        503: 'su API no tiene el token configurado',
      };
      return { ok: false, error: porQue[r.status] || `la API contestó ${r.status}` };
    }
    const b = await r.json().catch(() => null);
    const v = Number(
      typeof b === 'number' ? b
        : b?.tasa_cup ?? b?.cupPorUsd ?? b?.cup_por_usd ?? b?.cup ?? b?.tasa ?? b?.rate ?? b?.valor ?? b?.data?.tasa,
    );
    // Una tasa de 0 o negativa no es una tasa: es un fallo que llegó con forma de dato.
    // Guardarla dejaría todos los importes en CUP a cero sin que nada avisara.
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: `no entendí la respuesta: ${JSON.stringify(b).slice(0, 120)}` };
    }
    // Se apunta de dónde salió, con la fecha desde la que él la da por vigente: al
    // reproducir un importe hace falta saber no sólo cuánto era, sino desde cuándo.
    const desde = typeof b?.vigente_desde === 'string' ? ` desde ${b.vigente_desde}` : '';
    await ponerTasa(v, `delivery-apk:${SUCURSAL}${desde}`);
    return { ok: true, valor: v };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Arranca el refresco periódico. Lo llama el worker, no la API. */
export function arrancarTasaCambio(): void {
  if (!URL || !TOKEN) {
    console.log('[tasa] sin URL o sin token: no se trae (se usa la que se ponga a mano)');
    return;
  }
  /**
   * Cada 12 h cuando va bien, pero mucho antes cuando falla.
   *
   * Con un intervalo fijo, un fallo condena a PEDIDO a estar medio día sin tasa aunque el
   * problema se arregle a los cinco minutos — que es exactamente lo que pasó: la API de
   * tasas se desplegó justo después del primer intento y aquí nadie se iba a enterar
   * hasta la mañana siguiente.
   *
   * Reintenta a los 2, 5, 15 y 30 minutos y luego se queda en 30. Sin castigar a nadie
   * con un martilleo, pero atento: el día que la tasa vuelva, se coge sola.
   */
  const ESPERAS = [2, 5, 15, 30].map((m) => m * 60000);
  let fallos = 0;
  let temporizador: NodeJS.Timeout | null = null;

  const programar = (ms: number) => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(tirar, ms);
    temporizador.unref?.();
  };

  async function tirar() {
    const r = await traerTasa();

    if (r.ok) {
      if (fallos > 0) console.log(`[tasa] recuperada tras ${fallos} intento(s) fallido(s)`);
      fallos = 0;
      console.log(`[tasa] USD->CUP = ${r.valor}`);
      programar(CADA_MS);
      return;
    }

    const espera = ESPERAS[Math.min(fallos, ESPERAS.length - 1)];

    fallos++;
    // El primer fallo se cuenta entero; a partir del tercero se resume, para no llenar
    // el log con la misma línea cada media hora si esto va a estar días caído.
    if (fallos <= 2 || fallos % 10 === 0) {
      console.log(`[tasa] no se pudo traer (${r.error}); reintento en ${espera / 60000} min`);
    }
    programar(espera);
  }

  programar(20000);
  console.log(`[tasa] cada ${(CADA_MS / 3600000).toFixed(1)} h, y antes si falla`);
}
