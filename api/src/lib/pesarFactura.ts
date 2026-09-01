/**
 * Lo que pesa lo facturado, en kilos.
 *
 * De aquí sale el precio del domicilio cuando la factura cambia el pedido: se cobra por
 * peso. Vive aparte del barrido, sin tocar la base, porque es la parte que hay que poder
 * probar sola — es la que decide lo que se le cobra a alguien.
 *
 * Se cruza por CÓDIGO —el `productCode` de la venta es el `sku` del catálogo, los dos
 * salen de la misma base de Ventra— y sólo si no hay código se cae al nombre exacto. Nada
 * de aproximar por palabras: aquí una coincidencia de más no confunde una etiqueta en
 * pantalla, cambia un cobro.
 *
 * Devuelve `null` si alguna línea de MERCANCÍA se quedó sin pesar: el total iría corto, y
 * cobrar de menos tampoco se nota nunca. Los servicios no cuentan —no pesan ni viajan—, y
 * ése era el fallo grande: la línea de «ENTREGA A DOMICILIO» no tiene peso, así que
 * contaba como línea sin pesar y descartaba la recotización. O sea que justo las facturas
 * CON domicilio eran las únicas que no se podían recotizar.
 */
import { esServicio } from './servicios';

export type FilaCatalogo = {
  sku: string;
  nombre: string | null;
  pesoKg: number | null;
  categoria: string | null;
};

export function pesar(
  lineas: Array<{ producto: string; codigo: string | null; cantidad: number }>,
  catalogo: FilaCatalogo[],
): number | null {
  const porSku = new Map<string, number>();
  const porNombre = new Map<string, number>();

  for (const c of catalogo) {
    if (!c.pesoKg) continue;
    if (c.sku) porSku.set(c.sku.trim().toUpperCase(), c.pesoKg);
    if (c.nombre) porNombre.set(c.nombre.trim().toUpperCase(), c.pesoKg);
  }

  let kg = 0;
  let conPeso = 0;

  for (const l of lineas) {
    if (esServicio({ nombre: l.producto })) continue;

    const unitario = (l.codigo ? porSku.get(l.codigo.trim().toUpperCase()) : undefined)
      ?? porNombre.get((l.producto || '').trim().toUpperCase());

    if (!unitario) return null;
    conPeso++;
    kg += unitario * l.cantidad;
  }

  return conPeso > 0 && kg > 0 ? Number(kg.toFixed(3)) : null;
}
