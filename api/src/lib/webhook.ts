// El webhook configurable de la APK de DOMICILIO, en los dos sentidos: le avisamos de
// que hay un pedido que cotizar, y el secret de esta misma fila es con el que
// verificamos el costo que nos devuelven.
//
// Hubo un segundo destino, `parranda` («pedido completado»), que se quitó el 26/09/2026:
// nunca llegó a configurarse —ni una fila en la base, ni una URL, ni un envío en toda su
// vida— y dejarlo era una casilla encendida en Configuración que no hacía nada. Si
// alguna vez hace falta avisar a otro sitio, la tabla admite más filas y el camino está
// en el historial.
//
// Un solo secret por destino para ida y vuelta, no dos: son los dos extremos de la
// misma conversación. Con un secret por sentido, el día que se rote uno, alguien rota
// el que no era y la mitad de los mensajes se caen sin que nadie sepa cuál de los dos
// mirar.
//
// La config vive en la DB y la edita el SUPER ADMIN desde la UI — NO por .env. Eso es
// lo que permite cambiar la URL o rotar el secret sin volver a desplegar.
import crypto from 'crypto';
import prisma from '../prismaClient';
import { aplicarCostoDomicilio } from './domicilio';
import { emitEvent } from './events';

/**
 * `domicilio` es la APK de Entrega; `reparto` es delivery-logistica, la que carga los
 * camiones. Son dos conversaciones distintas, con su URL y su secret cada una: rotar el
 * de una no puede callar a la otra.
 */
export type Destino = 'domicilio' | 'reparto';

export type ConfigWebhook = { url: string; key: string; secret: string; activo: boolean };

// Cache corto para no pegarle a la DB en cada envío: la config cambia una vez al año y
// el worker manda en ráfagas de cientos.
const _cache = new Map<Destino, { at: number; cfg: ConfigWebhook }>();
const VIGENCIA_MS = 15000;

export async function getConfig(destino: Destino): Promise<ConfigWebhook> {
  const c = _cache.get(destino);
  if (c && Date.now() - c.at < VIGENCIA_MS) return c.cfg;

  let cfg: ConfigWebhook = { url: '', key: '', secret: '', activo: true };
  try {
    const row = await prisma.webhookConfig.findUnique({ where: { id: destino } });
    if (row) cfg = { url: row.url || '', key: row.apiKey || '', secret: row.secret || '', activo: row.activo };
  } catch {
    /* sin tabla/DB todavía: no-op */
  }
  _cache.set(destino, { at: Date.now(), cfg });
  return cfg;
}

/** Invalida el cache (llamar al guardar la config desde la UI). Sin destino, todos. */
export function invalidarWebhookCache(destino?: Destino): void {
  if (destino) _cache.delete(destino);
  else _cache.clear();
}

/** La firma que viaja en X-Webhook-Signature. La misma fórmula para mandar y para verificar. */
export function firmar(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Compara dos firmas sin filtrar por dónde dejan de parecerse.
 *
 * Un `===` sobre cadenas corta en el primer byte distinto, y el tiempo que tarda dice
 * cuántos acertó. Con eso se adivina una firma byte a byte sin conocer el secret.
 */
export function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST del payload al destino. LANZA si no se pudo entregar: es lo que hace que Bull
 * lo reintente. Para el camino best-effort (el de Parranda) está `enviarWebhook`.
 *
 * DEVUELVE EL CUERPO DE LA RESPUESTA, que antes se tiraba entero.
 *
 * Se leía sólo cuando fallaba, para el mensaje de error. Y resulta que el otro lado
 * contesta cosas: Entrega devuelve `{ status, costoRecalculado }` al aviso de factura
 * cambiada, o sea el precio nuevo del reparto. Descartándolo, el dato llegaba y se
 * perdía en el mismo instante.
 *
 * `null` si la respuesta no trae JSON: un 200 con el cuerpo vacío es una entrega
 * correcta, no un fallo.
 */
export async function entregarWebhook(destino: Destino, payload: unknown): Promise<unknown> {
  const { url, key, secret, activo } = await getConfig(destino);
  if (!url || !activo) return null; // sin configurar todavía: no es un fallo, es que no aplica

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['X-Webhook-Key'] = key;
  if (secret) headers['X-Webhook-Signature'] = firmar(secret, body);

  // Sin timeout, un receptor colgado deja el job ocupando un hueco del worker hasta que
  // el sistema operativo se aburra. Con la cola llena, eso es la cola parada.
  const corta = AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS || 15000));
  const res = await fetch(url, { method: 'POST', headers, body, signal: corta });

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    const fallo = new Error(`${url} -> ${res.status} ${detalle}`) as Error & { status?: number };

    // El código viaja con el error para que quien reintenta pueda decidir. Sin él, un
    // 401 de firma mala se reintenta tres veces y se tira, exactamente igual que una
    // base caída — y son cosas opuestas: una no se arregla esperando y la otra sí.
    fallo.status = res.status;
    throw fallo;
  }

  return await res.json().catch(() => null);
}

/** Igual, pero best-effort: nunca rompe el request que lo dispara. */
export async function enviarWebhook(destino: Destino, payload: unknown): Promise<void> {
  try {
    await entregarWebhook(destino, payload);
  } catch (e) {
    console.error(`[webhook:${destino}] falló:`, (e as Error).message);
  }
}

/**
 * Avisarle a ENTREGA de que un pedido cambió DESPUÉS de que ella le pusiera precio.
 *
 * # Por qué
 *
 * El cliente pide veinte cajas y se lleva quince. Eso se ve al facturar, y para entonces
 * el repartidor ya cotizó el domicilio de un pedido que pesaba otra cosa. La APK trabaja
 * sin conexión: no se le puede preguntar, hay que contárselo.
 *
 * # A quién se avisa, y a quién NO
 *
 * **Sólo a los pedidos que YA tienen costo de domicilio puesto.** Si Entrega todavía no
 * lo ha cotizado no hay nada que corregir: cuando le llegue por el camino normal ya
 * vendrá con lo facturado. Avisar de un cambio sobre algo que nunca vio es ruido, y el
 * ruido en un aviso es lo que hace que se dejen de mirar.
 *
 * Esa condición la comprueba quien llama —es donde se sabe—, y aquí se vuelve a mirar por
 * si acaso: es un aviso que sale de la casa, y cuesta menos comprobarlo dos veces que
 * explicar después por qué llegaron trescientos que no tocaban.
 *
 * # Best-effort
 *
 * Si Entrega no contesta, aquí no se rompe nada: el pedido ya está corregido y el aviso
 * se pierde. Va por la cola durable, así que se reintenta solo.
 */
export async function avisarPedidoCambiado(pedidoId: string): Promise<void> {
  const p = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: {
      id: true,
      folio: true,
      estado: true,
      estadoEntrega: true,
      costoDomicilio: true,
      requiere_domicilio: true,
      facturaNumero: true,
      facturaDiferencias: true,
      itemsOriginal: true,
      sucursal: { select: { codigo: true, nombre: true } },
      cliente: {
        select: {
          codigo: true, nombre: true, direccion: true, municipio: true,
          telefono: true, latitud: true, longitud: true,
        },
      },
      items: { select: { producto: true, codigo: true, unidades: true, packs: true } },
    },
  });

  // Sin costo puesto no hay nada que rehacer. Ver arriba.
  if (!p || p.costoDomicilio == null) return;

  /** Lo que pesaba ANTES, para que Entrega pueda ver de cuánto a cuánto se movió. */
  let itemsAnteriores: unknown = null;

  if (p.itemsOriginal) {
    try {
      itemsAnteriores = JSON.parse(p.itemsOriginal);
    } catch {
      // Un JSON ilegible no puede impedir el aviso: lo importante es lo de AHORA.
    }
  }

  const respuesta = await entregarWebhook('domicilio', {
    evento: 'pedido.cambiado',
    pedidoId: p.id,
    folio: p.folio,
    facturaNumero: p.facturaNumero,
    /**
     * LOS DOS estados, porque en PEDIDO son dos cosas y Entrega pidió «el estado».
     *
     *   estado        — el cierre en PEDIDO: `completada` o vacío. Manda sobre el
     *                   archivado, sobre el expirado y sobre los filtros de la lista.
     *   estadoEntrega — en qué punto del REPARTO va: despachado · en_transito ·
     *                   entregado · devuelto · cancelado. Lo escribe delivery.
     *
     * El ejemplo de Amado dice `"estado": "Entregada"`, que es el SEGUNDO. Mandar uno
     * solo con el nombre que él espera sería elegir por él y guardarle en `estado_pedido`
     * una cosa creyendo que es la otra — y un pedido puede estar completado aquí y
     * todavía dando vueltas en el camión. Van los dos y que coja el que necesite.
     */
    estado: p.estado,
    estadoEntrega: p.estadoEntrega,
    motivo: 'la factura cambió lo pedido',
    // Lo que Entrega ya había cobrado. Es lo que tiene que rehacer.
    costoDomicilioActual: p.costoDomicilio,
    requiereDomicilio: p.requiere_domicilio,
    sucursalCodigo: p.sucursal?.codigo ?? null,
    sucursalNombre: p.sucursal?.nombre ?? null,
    cliente: p.cliente,
    // Lo que el pedido dice AHORA, que es lo facturado.
    items: p.items,
    // Y lo que decía antes, para poder comparar. Null si no se guardó.
    itemsAnteriores,
    diferencias: p.facturaDiferencias ? JSON.parse(p.facturaDiferencias) : [],
  });

  await guardarRecalculo(p.id, p.costoDomicilio, respuesta);
}

/**
 * El precio nuevo que nos devuelve Entrega en la MISMA respuesta al aviso.
 *
 * Entrega contesta `{ "status": "ok", "costoRecalculado": 16.82 }`. Es el reparto
 * recotizado con el peso de lo que de verdad va en el camión, y es el motivo entero por
 * el que existe el aviso: sin esto mandábamos «oye, esto cambió», nos contestaban con el
 * precio bueno, y lo tirábamos.
 *
 * Se escribe por `aplicarCostoDomicilio`, la MISMA puerta por la que entra su webhook, y
 * no con un update suelto. Así valen todas las reglas —que el pedido lleve domicilio, que
 * sea de esta sucursal, y que se estampe la tasa CUP/USD del momento— en vez de tener dos
 * caminos que escriben el mismo campo con reglas distintas.
 *
 * Es idempotente y no compite con su envío normal: si Entrega además nos empuja ese mismo
 * importe por `/webhooks/domicilio`, es el mismo número y no cambia nada. La diferencia es
 * que por aquí llega YA, y no en la próxima corrida de su scheduler — que es justo lo que
 * hace falta cuando el cliente está delante esperando el precio.
 *
 * Nada de esto puede tumbar el aviso: si viene mal, se apunta y se sigue.
 */
async function guardarRecalculo(
  pedidoId: string,
  costoAnterior: number | null,
  respuesta: unknown,
): Promise<void> {
  if (!respuesta || typeof respuesta !== 'object') return;

  const crudo = (respuesta as Record<string, unknown>).costoRecalculado;
  if (crudo == null || crudo === '') return;

  const nuevo = Number(crudo);
  if (!Number.isFinite(nuevo) || nuevo < 0) {
    console.warn(`[webhook:domicilio] costoRecalculado inválido para ${pedidoId}: ${String(crudo)}`);
    return;
  }

  // El mismo precio no es un cambio. Sin esto, cada aviso reescribiría la tasa del
  // domicilio sin que el importe se moviera.
  if (costoAnterior != null && Number(costoAnterior.toFixed(2)) === Number(nuevo.toFixed(2))) return;

  try {
    const r = await aplicarCostoDomicilio({ pedidoId, costo: nuevo });

    if (!r.ok) {
      console.warn(`[webhook:domicilio] no se pudo guardar el recálculo de ${pedidoId}: ${r.motivo}`);
      return;
    }

    console.log(
      `[webhook:domicilio] recálculo guardado en ${pedidoId}: ${costoAnterior ?? '—'} -> ${nuevo}`,
    );

    // Que la pantalla lo enseñe sin recargar: el precio nuevo es lo que hay que decirle
    // al cliente, y llega mientras está delante.
    const tocado = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { sucursalId: true },
    });
    emitEvent('pedido', { id: pedidoId, sucursalId: tocado?.sucursalId ?? null, accion: 'update' });
  } catch (e) {
    console.error(`[webhook:domicilio] recálculo de ${pedidoId} falló:`, (e as Error).message);
  }
}

/**
 * Siembra la config de un destino desde el entorno, si viene, la PRIMERA vez.
 *
 * Sólo rellena lo que está VACÍO: nunca pisa lo que alguien puso en la pantalla de
 * Configuración. Sin esa regla, cada reinicio devolvería el secret al del .env y una
 * rotación hecha desde la UI se desharía sola en el siguiente despliegue, que es
 * justo el fallo que nadie relaciona con el reinicio.
 *
 * Existe para dejar una instalación lista sin pasar por la pantalla —cada sucursal
 * corre su propio PEDIDO y son varias—. A partir de ahí, la UI manda.
 */
export async function sembrarConfigDesdeEntorno(): Promise<void> {
  const destinos: Array<{ destino: Destino; prefijo: string }> = [
    { destino: 'domicilio', prefijo: 'WEBHOOK_DOMICILIO' },
  ];

  for (const { destino, prefijo } of destinos) {
    const url = (process.env[`${prefijo}_URL`] || '').trim();
    const key = (process.env[`${prefijo}_KEY`] || '').trim();
    const secret = (process.env[`${prefijo}_SECRET`] || '').trim();
    if (!url && !key && !secret) continue;

    try {
      const row = await prisma.webhookConfig.findUnique({ where: { id: destino } });
      const data: Record<string, unknown> = {};
      if (url && !row?.url) data.url = url;
      if (key && !row?.apiKey) data.apiKey = key;
      if (secret && !row?.secret) data.secret = secret;
      if (Object.keys(data).length === 0) continue;

      await prisma.webhookConfig.upsert({
        where: { id: destino },
        update: data,
        create: { id: destino, ...data },
      });
      invalidarWebhookCache(destino);
      console.log(`[webhook:${destino}] config sembrada desde el entorno: ${Object.keys(data).join(', ')}`);
    } catch (e) {
      // Que no se pueda sembrar no puede impedir que arranque la API.
      console.error(`[webhook:${destino}] no se pudo sembrar:`, (e as Error).message);
    }
  }
}
