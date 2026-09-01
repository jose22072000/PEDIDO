/**
 * Preguntarle a DELIVERY cuánto cuesta un domicilio.
 *
 * La fórmula es la de Entrega —tarifa × distancia × peso—, y quien la tiene con todas
 * sus piezas es delivery: allí viven los almacenes desde los que se mide, y allí llega
 * la tarifa y la tasa de cada sucursal a través de Accesos. Repetirla aquí sería tener
 * dos fórmulas para el mismo cobro, que es exactamente de donde se viene.
 *
 * Se le pregunta cuando la FACTURA cambia el pedido. A la APK de Entrega no se le puede
 * avisar —trabaja sin conexión y sincroniza cuando puede—, así que el precio se rehace
 * de este lado y el repartidor se lo encuentra ya corregido en vez de tener que rehacerlo
 * él.
 *
 * Es «lo mejor que se pueda»: si delivery no contesta, el pedido se queda con el costo
 * que tenía. Un domicilio en cero, o borrado, sería peor que uno viejo.
 */

const DELIVERY_URL = process.env.DELIVERY_API_URL || process.env.DELIVERY_URL || 'http://localhost:3002';
const KEY = process.env.SERVICE_API_KEY || '';

export interface CostoDomicilio {
  usd: number;
  cup: number | null;
  distanciaKm: number;
}

export interface PeticionCosto {
  sucursalCodigo: string;
  lat: number;
  lng: number;
  pesoKg: number;
}

/**
 * Devuelve `null` cuando no se pudo saber: sin tarifa, sin tasa, sin almacén con punto,
 * o sin delivery al otro lado. Nunca un cero — un cero se suma y se lee como que ese
 * reparto salió gratis.
 */
export async function costoDomicilioDeDelivery(p: PeticionCosto): Promise<CostoDomicilio | null> {
  if (!KEY) return null;
  if (!p.sucursalCodigo || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  if (!Number.isFinite(p.pesoKg) || p.pesoKg <= 0) return null;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);

  try {
    const res = await fetch(`${DELIVERY_URL}/api/quote/home-delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify(p),
      signal: ctl.signal,
    });

    if (!res.ok) return null;

    const d = (await res.json()) as { usd?: number; cup?: number | null; distanciaKm?: number };

    if (!Number.isFinite(Number(d.usd))) return null;

    return {
      usd: Number(d.usd),
      cup: Number.isFinite(Number(d.cup)) ? Number(d.cup) : null,
      distanciaKm: Number(d.distanciaKm) || 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
