/**
 * Qué productos de un pedido son de Parranda, y en qué formato.
 *
 * Vivía dentro de `webhook.ts` porque su único uso era el aviso de «pedido completado».
 * Ese webhook se quitó el 26/09/2026 —nunca llegó a configurarse—, pero la
 * clasificación sigue haciendo falta: la usa el endpoint que le sirve los pedidos a
 * Parranda por la API. Se queda en su propio fichero, que es donde tenía que haber
 * estado: no tiene nada que ver con mandar avisos.
 */

/**
 * SOLO los productos de Parranda: la cerveza «Parranda» en 330/500/1500 ml y la «Malta
 * Guajira» en 330/1500 ml (la malta NO tiene 500). Todo lo demás del pedido se ignora.
 *
 * Devuelve el formato en ml, o `null` si el ítem no es un producto Parranda.
 */
export function clasificarParranda(nombre: string): { producto: string; formatoMl: number } | null {
  const n = String(nombre || '').toUpperCase();
  const fmt = /0\.33L|(^|\D)330(\D|$)/.test(n) ? 330
    : /1\.5L|(^|\D)1500(\D|$)/.test(n) ? 1500
    : /0\.5L|(^|\D)500(\D|$)/.test(n) ? 500
    : 0;

  if (!fmt) return null;
  if (n.includes('PARRANDA')) return { producto: 'Parranda', formatoMl: fmt };            // 330/500/1500
  if (n.includes('MALTA') && fmt !== 500) return { producto: 'Malta Guajira', formatoMl: fmt }; // 330/1500

  return null;
}
