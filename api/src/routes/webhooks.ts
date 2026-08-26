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
 * Body: { entregas: [{ pedidoId? , folio?, vendedorCodigo?, costo, distanciaKm?, distanciaDesde? }] }
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
    : Array.isArray(cuerpo.updates)   // el nombre que usaba delivery, por si acaso
      ? cuerpo.updates
      : cuerpo.costo != null
        ? [cuerpo]                    // una sola, sin envolver
        : [];

  if (entregas.length === 0) {
    return res.status(400).json({ error: 'No vino ninguna entrega. Se espera { entregas: [{ folio, costo }] }.' });
  }
  if (entregas.length > 500) {
    return res.status(413).json({ error: 'Máximo 500 entregas por llamada.' });
  }

  const aplicadas: Array<{ pedidoId?: string; folio?: string }> = [];
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
        costo: e.costo ?? e.costoDomicilio ?? e.precio,
        distanciaKm: e.distanciaKm ?? e.distancia_km ?? null,
        // Desde qué punto se midió. Si no lo mandan, se apunta la sucursal, que es lo
        // único que se sabe con certeza.
        distanciaDesde: e.distanciaDesde ?? e.distancia_desde ?? null,
        // Dónde está el cliente, si la APK lo averiguó y nosotros no lo teníamos.
        latitud: e.latitud ?? e.lat ?? e.clienteLatitud ?? null,
        longitud: e.longitud ?? e.lng ?? e.clienteLongitud ?? null,
      });
      if (r.ok) aplicadas.push({ pedidoId: r.pedidoId, folio: r.folio });
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
  res.json({ recibidas: entregas.length, aplicadas: aplicadas.length, rechazadas });
});

export default router;
