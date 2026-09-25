/**
 * El cliente de CONSUMO PROPIO de cada vendedor.
 *
 * # Qué es
 *
 * Un cliente que no es un cliente: es el cajón donde el vendedor mete al que viene a
 * comprar poco y no tiene ficha. Cada vendedor tiene el suyo y lo reutiliza todos los
 * días — sube un pedido grande y de ahí va tirando.
 *
 * # Por qué hace falta reconocerlos
 *
 * Para facturar hay que copiar `P-folio; V-vendedor; C-cliente;` del pedido, y el de
 * consumo propio es el que más se copia de todos. Buscarlo en la lista es filtrar por el
 * vendedor, mirar cuál de sus pedidos es el del consumo y abrirlo: tres pasos, cada vez,
 * todo el día.
 *
 * # Cómo se reconocen, y por qué no hay una casilla
 *
 * Por el NOMBRE, porque es lo único que hay: nadie marcó nunca estos clientes y son 147
 * repartidos por ocho sucursales, cada una con su forma de escribirlo:
 *
 *     CONSUMO PROPIO (ALEXANDER)              Camagüey
 *     CLIENTE CONSUMO MARIACNELIS             Holguín
 *     LEODANIS CHACON(PDV CLIENTE DE CONSUMO) Las Tunas
 *     PDV_ LAS TUNAS                          Las Tunas, y 660 pedidos
 *
 * Con las faltas de ortografía que trae la vida: `COMSUMO`, `COSUMO`, `CLIENTECONSUMO`
 * todo junto. Por eso la palabra se busca con un patrón y no con un `includes`.
 *
 * **`PUNTO DE VENTA` NO cuenta, y es la parte importante.** En Holguín hay ochenta
 * clientes que se llaman así —«PUNTO DE VENTA YAMILA BLANCO»— y son clientes de verdad,
 * kioscos con su dueño y su ficha. Meterlos aquí llenaría el cajón de gente que no pinta
 * nada y, peor, le diría a la operadora que ése es el consumo propio de alguien.
 * `PDV` sí cuenta: en Las Tunas es como llaman al suyo, y ahí no se usa para nada más.
 */

/** Sin tildes, en mayúsculas y con todo lo que no es letra o número vuelto espacio. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** CONSUMO, y como lo escribe quien va deprisa: COMSUMO, COSUMO. */
const CONSUMO = /C[O0][NM]?SUMO/;

export function esConsumoPropio(nombre: string | null | undefined): boolean {
  if (!nombre) return false;

  const limpio = normalizar(nombre);

  // La palabra puede venir pegada a otra (`CLIENTECONSUMO`), así que se busca dentro.
  if (CONSUMO.test(limpio)) return true;

  // `PDV` tiene que ser una palabra suya: `PDV_ LAS TUNAS` sí, pero una ficha que
  // empiece por esas tres letras dentro de otra palabra, no.
  return limpio.split(' ').includes('PDV');
}
