// La ENTRADA: lo que la APK de domicilio nos manda de vuelta.
//
// Va aparte de /integration a propósito. /integration es la puerta por la que otros
// sistemas nuestros LEEN, con la clave de servicio compartida; esto es una puerta que
// ESCRIBE y que abre un tercero, así que se protege con su propio secret —el de la fila
// `domicilio`, rotable desde Configuración sin desplegar— y se verifica por firma, no
// por una clave que viaja en claro en cada petición.
import { Router } from 'express';
import { getConfig, firmar, firmaValida } from '../lib/webhook';
import { aplicarCostoDomicilio } from '../lib/domicilio';
import { emitEvent } from '../lib/events';
import prisma from '../prismaClient';

const router = Router();

/**
 * Comprueba que quien llama es quien dice ser.
 *
 * Sin secret configurado NO se acepta nada: un endpoint que escribe en los pedidos y
 * está abierto a internet es peor que un endpoint que no existe. Devuelve 503 —"esto
 * todavía no está configurado"— y no 401, porque el que llama no tiene nada que
 * arreglar de su lado.
 *
 * La firma se calcula sobre el cuerpo EXACTO que llegó, no sobre el JSON reserializado:
 * dos serializaciones del mismo objeto pueden diferir en el orden de las claves o en un
 * espacio, y entonces la firma no cuadra jamás por un motivo que no se ve.
 */
// Devuelve null si todo bien, o el fallo a contestar. (Un union discriminado se
// leería mejor, pero este proyecto compila sin strictNullChecks y ahí no estrecha.)
async function verificar(req: any): Promise<{ status: number; error: string } | null> {
  const fallo = await comprobar(req);

  /**
   * UN RECHAZO TIENE QUE DEJAR RASTRO.
   *
   * Esta puerta contestaba 401 y no escribía nada en ningún sitio: el API solo registra
   * los 5xx. Desde fuera, quien integra ve «mando y no pasa nada»; desde dentro, no hay
   * forma de saber si es que no llaman o es que llaman y se les rechaza. El 09/09/2026 se
   * perdió media mañana en esa pregunta, con 813 domicilios sin costo y la clave de
   * lectura de la APK usada 418 veces: se sabía que leían y no se podía saber si escribían.
   *
   * Se apunta QUÉ falló y desde dónde. Nunca la firma ni el cuerpo: la firma es un secreto
   * a medias —con ella y el cuerpo se rehace el HMAC— y el cuerpo lleva datos de clientes.
   */
  if (fallo) {
    // eslint-disable-next-line no-console
    console.warn(
      `[webhook:domicilio] RECHAZADO ${fallo.status} — ${fallo.error} · ip=${req.ip || '?'} ` +
        `· key=${req.headers['x-webhook-key'] ? 'sí' : 'no'} ` +
        `· firma=${req.headers['x-webhook-signature'] ? 'sí' : 'no'} ` +
        /**
         * La FORMA de la firma, que no es la firma.
         *
         * Con «firma inválida» a secas no se distingue el fallo más común —mandar el hex
         * pelado, sin el prefijo `sha256=`, que aquí no cuadra jamás porque se comparan
         * las cadenas enteras— de firmar un cuerpo distinto del que se manda. El largo y
         * el prefijo lo dicen: 71 con prefijo es la forma correcta y el fallo está en el
         * cuerpo o en el secreto; 64 sin prefijo es que falta el prefijo.
         *
         * Ni el largo ni el prefijo permiten rehacer la firma, así que no se filtra nada.
         */
        `· formaFirma=${String(req.headers['x-webhook-signature'] || '').startsWith('sha256=') ? 'sha256=' : 'sin prefijo'}` +
        `/${String(req.headers['x-webhook-signature'] || '').length} ` +
        `· bytes=${req.rawBody ? req.rawBody.length : 0}`,
    );
  }

  return fallo;
}

async function comprobar(req: any): Promise<{ status: number; error: string } | null> {
  const { secret, key, activo } = await getConfig('domicilio');

  if (!secret) {
    return { status: 503, error: 'El webhook de domicilio no está configurado todavía (falta el secret).' };
  }
  if (!activo) {
    return { status: 503, error: 'El webhook de domicilio está desactivado.' };
  }

  if (key) {
    const recibida = String(req.headers['x-webhook-key'] || '');
    if (recibida !== key) return { status: 401, error: 'X-Webhook-Key no coincide.' };
  }

  const crudo: Buffer | undefined = req.rawBody;
  if (!crudo) return { status: 400, error: 'Cuerpo vacío o no leído.' };

  const firma = String(req.headers['x-webhook-signature'] || '');
  if (!firma) return { status: 401, error: 'Falta la cabecera X-Webhook-Signature.' };
  if (!firmaValida(firmar(secret, crudo.toString('utf8')), firma)) {
    return { status: 401, error: 'Firma inválida.' };
  }

  return null;
}

/**
 * POST /webhooks/ping
 * Para probar la conexión y la firma SIN tocar ningún pedido. Es lo primero que hay que
 * hacer al configurar: si esto no devuelve ok, el problema es de firma, no de datos.
 */
router.post('/ping', async (req, res) => {
  const mal = await verificar(req);
  if (mal) return res.status(mal.status).json({ error: mal.error });
  res.json({ ok: true, recibido: (req.body ?? null), en: new Date().toISOString() });
});

/**
 * POST /webhooks/domicilio
 * Body: { entregas: [{ pedidoId?, folio?, clienteCodigo?, clienteNombre?, vendedorCodigo?,
 *                       costo, distanciaKm?, distanciaDesde? }] }
 *
 * En LOTE e idempotente: mandar dos veces lo mismo deja lo mismo, así que ante la duda
 * se reintenta y ya. Cada entrega se responde por separado —lo que se aplicó y lo que
 * no, con el motivo— en vez de fallar el lote entero: que un folio venga mal no es
 * razón para descartar los otros veinte que venían bien.
 */
router.post('/domicilio', async (req, res) => {
  const mal = await verificar(req);
  if (mal) return res.status(mal.status).json({ error: mal.error });

  const cuerpo = req.body || {};
  const entregas = Array.isArray(cuerpo.entregas)
    ? cuerpo.entregas
    : cuerpo.costo != null
        ? [cuerpo]                    // una sola, sin envolver
        : [];

  if (entregas.length === 0) {
    return res.status(400).json({ error: 'No vino ninguna entrega. Se espera { entregas: [{ folio, costo }] }.' });
  }
  if (entregas.length > 500) {
    return res.status(413).json({ error: 'Máximo 500 entregas por llamada.' });
  }

  /**
   * Lo que se contesta a Entrega: por cada entrega, QUÉ se guardó.
   *
   * No vale con decir "aplicada". Entrega manda varias cosas juntas y cada una
   * puede entrar o no: una tasa en cero se descarta, una coordenada fuera de Cuba se
   * descarta, y una ubicación idéntica a la que ya había no se toca. Si la respuesta
   * no lo dijera, del otro lado se daría por guardado algo que no lo está.
   */
  const aplicadas: Array<{ pedidoId?: string; folio?: string; guardado: string[] }> = [];
  const rechazadas: Array<{ folio?: string; pedidoId?: string; motivo: string }> = [];

  for (const e of entregas) {
    if (!e || typeof e !== 'object') {
      rechazadas.push({ motivo: 'entrada no es un objeto' });
      continue;
    }
    try {
      const r = await aplicarCostoDomicilio({
        pedidoId: e.pedidoId ?? e.id ?? null,
        folio: e.folio ?? null,
        vendedorCodigo: e.vendedorCodigo ?? e.vendedor ?? null,
        // Quién es el cliente de ese folio: es lo que deja usar el folio TAL COMO lo da
        // Parranda, sin que del otro lado tengan que conocer los sufijos que les ponemos
        // aquí cuando un mismo folio trae varios clientes. Ver `aplicarCostoDomicilio`.
        clienteCodigo: e.clienteCodigo ?? e.codigoCliente ?? e.cliente_codigo ?? e.parrandaId ?? null,
        clienteNombre: e.clienteNombre ?? e.nombreCliente ?? e.cliente_nombre ??
          (typeof e.cliente === 'string' ? e.cliente : e.cliente?.nombre) ?? null,
        costo: e.costo ?? e.costoDomicilio ?? e.precio,
        distanciaKm: e.distanciaKm ?? e.distancia_km ?? null,
        // Desde qué punto se midió. Si no lo mandan, se apunta la sucursal, que es lo
        // único que se sabe con certeza.
        distanciaDesde: e.distanciaDesde ?? e.distancia_desde ?? null,
        // Dónde está el cliente de verdad, según quien fue a llevarle el pedido. Puede
        // corregir lo que ya teníamos; lo anterior queda guardado en ClienteGeoCambio.
        latitud: e.latitud ?? e.lat ?? e.clienteLatitud ?? null,
        longitud: e.longitud ?? e.lng ?? e.clienteLongitud ?? null,
      });
      if (r.ok) {
        const c = r.cambios;
        const guardado: string[] = [];
        if (c?.costo) guardado.push('costo');
        if (c?.tasa) guardado.push('tasa');
        if (c?.distancia) guardado.push('distancia');
        if (c?.ubicacionCliente) guardado.push('ubicacionCliente');
        aplicadas.push({ pedidoId: r.pedidoId, folio: r.folio, guardado });
      }
      else rechazadas.push({ pedidoId: r.pedidoId, folio: r.folio, motivo: r.motivo || 'no aplicada' });
    } catch (err) {
      rechazadas.push({ folio: e.folio, pedidoId: e.pedidoId, motivo: (err as Error).message });
    }
  }

  // Que la pantalla de pedidos lo enseñe sin que nadie recargue: el costo aparece en la
  // línea de ENTREGA A DOMICILIO en cuanto entra.
  if (aplicadas.length) {
    const ids = aplicadas.map((a) => a.pedidoId).filter((x): x is string => !!x);
    const tocados = await prisma.pedido.findMany({
      where: { id: { in: ids } },
      select: { id: true, sucursalId: true },
    });
    for (const t of tocados) emitEvent('pedido', { id: t.id, sucursalId: t.sucursalId, accion: 'update' });
  }

  console.log(`[webhook:domicilio] entrada: ${aplicadas.length} aplicadas, ${rechazadas.length} rechazadas`);

  /**
   * Y POR QUE se rechazaron.
   *
   * El recuento solo decia "0 aplicadas, 6 rechazadas", que desde fuera se ve igual que
   * un exito —la llamada devuelve 200 con el detalle en el cuerpo— y desde dentro no
   * dice nada: seis rechazos por folio inexistente y seis por costo invalido se leen
   * igual y se arreglan distinto. Paso el 09/09/2026: la firma ya entraba, no se aplicaba
   * nada, y hubo que mirar el codigo para saber que preguntar.
   *
   * Va el folio y el motivo, agrupado. El folio no es un secreto —es el numero que las
   * dos partes usan para hablar del mismo pedido— y sin el no se puede comprobar ni uno.
   */
  if (rechazadas.length) {
    const porMotivo = new Map<string, string[]>();

    for (const r of rechazadas) {
      const ref = r.folio || r.pedidoId || '(sin identificar)';
      porMotivo.set(r.motivo, [...(porMotivo.get(r.motivo) || []), ref]);
    }
    for (const [motivo, refs] of porMotivo) {
      console.warn(
        `[webhook:domicilio] rechazadas ${refs.length} por "${motivo}" — ${refs.slice(0, 8).join(', ')}` +
          (refs.length > 8 ? ` y ${refs.length - 8} mas` : ''),
      );
    }
  }
  /**
   * SI NO ENTRÓ NINGUNA, NO ES UN 200.
   *
   * Se contestaba 200 siempre, con el detalle en el cuerpo. Quien no lee el cuerpo —que
   * es lo normal cuando el código dice que fue bien— ve un envío correcto y se queda
   * tan tranquilo. Los TRES problemas de esta semana con la APK de Entrega (la firma
   * inválida, el folio con la fecha inventada y los costos en pedidos sin domicilio)
   * habrían saltado el primer día con un código de error.
   *
   * 422 y no 400: la petición está bien formada y la firma es válida; lo que no se puede
   * procesar es su CONTENIDO. Y no 500, que invitaría a reintentar creyendo que el fallo
   * es nuestro.
   *
   * Si entró aunque sea una, sigue siendo 200: un folio malo entre veinte no convierte la
   * llamada en un fracaso, y el cuerpo dice cuál falló.
   */
  const ninguna = aplicadas.length === 0 && rechazadas.length > 0;

  res.status(ninguna ? 422 : 200).json({
    ok: rechazadas.length === 0,
    recibidas: entregas.length,
    // El detalle de cada una, no sólo el número: es lo que deja ver que la ubicación
    // que mandó el repartidor entró de verdad, y no sólo que el costo se guardó.
    aplicadas,
    rechazadas,
  });
});

export default router;
