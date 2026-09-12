/**
 * El pedido no tiene factura, pero al MISMO CLIENTE se le facturó esos días.
 *
 * # Qué problema resuelve
 *
 * Cuando un cliente tiene dos pedidos abiertos, el facturador escribe en la nota el folio
 * del otro. La mercancía sale, la factura existe, y el pedido que se quedó sin ella
 * aparece como «no apareció». Alguien lo cierra a mano y ahí muere: en septiembre fueron
 * 30 pedidos, y de esos 13 tenían una factura al mismo cliente con LAS MISMAS CANTIDADES.
 *
 * `PAA26-260911-1856` pidió Parranda ×10 y RONE0009 ×10; la factura 18142 tiene
 * exactamente eso, con el folio `PAA26-260910-1842` del mismo cliente.
 *
 * # Por qué AVISA y no empareja
 *
 * Emparejar por cliente es el fallo de julio otra vez: se cruzaba por nombre de cliente y
 * la factura 1024237 acabó pegada a los DOS pedidos de CAFETERIA POLO, uno completado y
 * otro en proceso. Ninguno decía la verdad y el que estaba mal parecía correcto.
 *
 * Aquí no se toca ningún pedido. Se dice «esta factura se parece a la tuya y fue a este
 * otro folio», y decide una persona. La regla de que una factura nombra UN folio y va a
 * ese pedido no se rompe.
 *
 * # Por qué se compara por NOMBRE y no por código
 *
 * Porque el código del pedido no siempre es el de Ventra. De los 15 códigos distintos que
 * usó Camagüey en septiembre, cuatro no existen allí: `Parranda 0.5L`, `Parranda 1.5L` y
 * `Malta Guajira 1.5L` son nombres escritos a mano, y `HGH0013` es `HGHG0014` con una `G`
 * de menos. El NOMBRE del producto sí viene bien —esa misma línea dice «HIGIENE-HOGAR
 * PAPEL HIGIENICO MANATI 15M PACA 12P DE 4U»—, así que comparar por nombre traduce el
 * código malo sin tener que mantener una tabla que se quedaría vieja.
 *
 * El código se usa igualmente cuando los dos lo traen y coincide: es exacto y más barato.
 */
import { clienteDeLaNota, folioDeLaNota } from './emparejarFactura';
import { elegirLinea } from './cotejarFactura';

export interface LineaVenta {
  operNumber: string;
  fecha: string;
  nota: string | null;
  productoCodigo: string | null;
  productoNombre: string;
  cantidad: number;
}

export interface PedidoSinFactura {
  folio: string;
  fecha: string | Date;
  clienteCodigo: string | null;
  clienteNombre: string | null;
  vendedor: string | null;
  items: { codigo: string | null; producto: string | null; packs: number }[];
}

export interface Candidata {
  factura: string;
  fecha: string;
  /** El folio al que esa factura fue a parar. `null` si no llevaba ninguno. */
  folioDeLaFactura: string | null;
  /** Las líneas del pedido que aparecen en esa factura, y con qué cantidad. */
  lineas: { pidio: string; packs: number; facturado: string; cantidad: number; cuadra: boolean }[];
  /** Todas las líneas del pedido están en la factura con la misma cantidad. */
  cuadraEntera: boolean;
}

export interface Aviso {
  folio: string;
  fecha: string;
  cliente: string | null;
  vendedor: string | null;
  candidatas: Candidata[];
}

const soloDia = (d: string | Date) =>
  (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

function dentroDeLaVentana(dia: string, fechaFactura: string, dias: number): boolean {
  const f = soloDia(fechaFactura);

  if (f < dia) return false;

  const tope = new Date(new Date(`${dia}T00:00:00Z`).getTime() + dias * 86400000)
    .toISOString()
    .slice(0, 10);

  return f <= tope;
}

/**
 * @param pedidos  los que se quedaron SIN factura. Quien llama ya los ha filtrado.
 * @param ventas   las líneas facturadas de esa sucursal en el periodo.
 * @param dias     cuántos días después del pedido se mira. Tres por defecto, que es lo
 *                 que tarda en facturarse lo que se factura tarde.
 */
export function buscarFacturaEnOtroFolio(
  pedidos: PedidoSinFactura[],
  ventas: LineaVenta[],
  dias = 3,
): Aviso[] {
  /** Los folios que YA tienen factura: sus pedidos no son huérfanos. */
  const facturados = new Set<string>();
  /** Las líneas de cada cliente, por NUESTRO código, que es lo que la nota escribe. */
  const porCliente = new Map<string, LineaVenta[]>();

  for (const v of ventas) {
    const folio = folioDeLaNota(v.nota);

    if (folio) facturados.add(folio);

    const cliente = clienteDeLaNota(v.nota);

    if (!cliente) continue;

    const suyas = porCliente.get(cliente);

    if (suyas) suyas.push(v);
    else porCliente.set(cliente, [v]);
  }

  const avisos: Aviso[] = [];

  for (const p of pedidos) {
    const codigo = (p.clienteCodigo || '').trim().toUpperCase();

    if (!codigo) continue;
    // Si su propio folio ya tiene factura no es huérfano y no hay nada que avisar.
    if (facturados.has(p.folio.toUpperCase())) continue;

    const dia = soloDia(p.fecha);
    const suyas = (porCliente.get(codigo) || []).filter((v) => dentroDeLaVentana(dia, v.fecha, dias));

    if (suyas.length === 0) continue;

    /** Las líneas de cada factura, juntas: se avisa de facturas, no de líneas sueltas. */
    const porFactura = new Map<string, LineaVenta[]>();

    for (const v of suyas) {
      const suya = porFactura.get(v.operNumber);

      if (suya) suya.push(v);
      else porFactura.set(v.operNumber, [v]);
    }

    const candidatas: Candidata[] = [];

    for (const [numero, lineasFactura] of porFactura) {
      // La factura que fue al propio folio del pedido no es «otro folio».
      const folioDeEsa = folioDeLaNota(lineasFactura[0]?.nota ?? null);

      if (folioDeEsa && folioDeEsa === p.folio.toUpperCase()) continue;

      const candidatas2 = lineasFactura.map((l) => ({
        producto: l.productoNombre,
        codigo: l.productoCodigo,
        cantidad: l.cantidad,
      }));

      const lineas = [];

      for (const it of p.items) {
        // `elegirLinea` es la misma que usa el cotejo: código exacto, y si no, el nombre
        // que más palabras comparta, y sólo si gana sola.
        const elegida = elegirLinea(
          { codigo: it.codigo ?? null, producto: it.producto ?? null, packs: it.packs },
          candidatas2,
        );

        if (!elegida) continue;

        lineas.push({
          pidio: it.producto || it.codigo || '',
          packs: it.packs,
          facturado: elegida.producto,
          cantidad: elegida.cantidad,
          cuadra: elegida.cantidad === it.packs,
        });
      }

      if (lineas.length === 0) continue;

      candidatas.push({
        factura: numero,
        fecha: soloDia(lineasFactura[0].fecha),
        folioDeLaFactura: folioDeEsa,
        lineas,
        cuadraEntera: lineas.length === p.items.length && lineas.every((l) => l.cuadra),
      });
    }

    if (candidatas.length === 0) continue;

    // Primero la que cuadra entera: es la que casi seguro es.
    candidatas.sort((a, b) => Number(b.cuadraEntera) - Number(a.cuadraEntera));

    avisos.push({
      folio: p.folio,
      fecha: dia,
      cliente: p.clienteNombre,
      vendedor: p.vendedor,
      candidatas,
    });
  }

  return avisos;
}
