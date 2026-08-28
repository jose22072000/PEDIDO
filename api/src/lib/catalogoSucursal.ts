/**
 * El catálogo de Ventra de una sucursal, leído de la base e indexado.
 *
 * El cruce en sí —qué fila le toca a cada línea— está en `cruceProducto`, sin Prisma
 * delante, para poder probarlo. Aquí sólo se leen las filas y los vínculos.
 *
 * Esto estaba escrito dos veces: en `conPrecios` (el panel) y en `/integration/orders`
 * (lo que se le manda a delivery). Dos implementaciones del mismo cruce, y no daban lo
 * mismo:
 *
 *   - El panel usaba los VÍNCULOS A MANO (`ProductoVinculo`); la integración no. Así que
 *     un producto atado por una persona salía con precio en pantalla y sin peso en el
 *     payload — y delivery cobraba el domicilio de un pedido que "no pesa nada".
 *   - Con el producto duplicado en Ventra, el panel se quedaba con la fila que TIENE
 *     PRECIO y la integración con la que TIENE PESO. Podían ser filas distintas.
 */

import prisma from '../prismaClient';
import { normalizarProducto } from './nombreProducto';
import { indexarCatalogo, type CatalogoSucursal } from './cruceProducto';

export { unidadesDeVenta } from './cruceProducto';
export type { CatalogoSucursal, FilaCatalogo } from './cruceProducto';

/** Los vínculos que alguien ató a mano, normalizados a las dos puntas. */
async function leerVinculos(): Promise<Map<string, string>> {
  const filas = await prisma.productoVinculo.findMany({
    select: { nombrePedido: true, nombreVentra: true },
  });
  return new Map(
    filas.map((v) => [normalizarProducto(v.nombrePedido), normalizarProducto(v.nombreVentra)] as const),
  );
}

/**
 * El catálogo ENTERO de esa sucursal, no filtrado por nombre.
 *
 * Filtrarlo con `nombre: { in: [...] }` era pedirle a la base los productos que se
 * llamaran EXACTAMENTE como en el pedido —"ALIMENTOS ARROZ BLANCO 25KG SACO"— y ese
 * nombre no existe en Ventra: siempre volvía vacío. Son ~127 filas por sucursal.
 */
export async function catalogoDeSucursal(sucursalId: string): Promise<CatalogoSucursal> {
  const [filas, vinculos] = await Promise.all([
    prisma.productoSucursal.findMany({
      where: { sucursalId },
      select: { nombre: true, precio: true, pesoKg: true, stock: true },
    }),
    leerVinculos(),
  ]);
  return indexarCatalogo(filas, vinculos);
}

/**
 * Los catálogos de VARIAS sucursales de una vez.
 *
 * Una consulta por sucursal presente y no una por pedido, y los vínculos —que son
 * globales— se leen UNA sola vez para todas.
 */
export async function catalogosDeSucursales(
  sucursalIds: string[],
): Promise<Map<string, CatalogoSucursal>> {
  const ids = [...new Set(sucursalIds.filter(Boolean))];
  const out = new Map<string, CatalogoSucursal>();
  if (!ids.length) return out;

  const vinculos = await leerVinculos();
  for (const sucursalId of ids) {
    const filas = await prisma.productoSucursal.findMany({
      where: { sucursalId },
      select: { nombre: true, precio: true, pesoKg: true, stock: true },
    });
    out.set(sucursalId, indexarCatalogo(filas, vinculos));
  }
  return out;
}
