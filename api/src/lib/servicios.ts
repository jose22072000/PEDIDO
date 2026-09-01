/**
 * Lo que NO es mercancía.
 *
 * En el catálogo de Ventra conviven los productos con líneas de servicio: la más
 * importante es «ENTREGA A DOMICILIO», categoría `SERV` y peso cero. No es algo que se
 * carga en un camión ni que se le entrega a nadie: es el propio cobro del reparto,
 * facturado como una línea más.
 *
 * Confundirla con mercancía hace tres estropicios seguidos:
 *
 *  - Sale en el buscador de productos al meter un pedido a mano, y alguien la elige.
 *  - Al pesar la factura cuenta como «una línea sin peso», y con eso se descarta la
 *    recotización entera del domicilio — o sea que justo la factura que lleva domicilio
 *    es la que no se puede recotizar.
 *  - Al copiar la factura al pedido, mete el cobro del reparto dentro de la mercancía y
 *    el pre-despacho enseña una línea que no existe.
 *
 * Y al revés: esa línea es la señal MÁS fiable de que un pedido va a domicilio, porque
 * sale de lo que se cobró y no de una casilla que alguien marcó.
 */

/** Categorías de Ventra que no son mercancía. */
const CATEGORIAS = new Set(['serv', 'servicio', 'servicios']);

const sinTildes = (s: string): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface AlgoDelCatalogo {
  nombre?: string | null;
  categoria?: string | null;
}

/** ¿Es una línea de servicio y no algo que se transporta? */
export function esServicio(x: AlgoDelCatalogo): boolean {
  if (CATEGORIAS.has(sinTildes(x.categoria ?? ''))) return true;

  // Y por el nombre, para el día que a alguien se le olvide la categoría. Se pide la
  // frase entera: un producto que se llamara «CERVEZA» no cuela por llevar «entrega».
  return esEntregaADomicilio(x);
}

/** ¿Es precisamente la línea del cobro del reparto? */
export function esEntregaADomicilio(x: AlgoDelCatalogo): boolean {
  const n = sinTildes(x.nombre ?? '');

  return n.includes('entrega a domicilio') || n.includes('servicio de entrega');
}
