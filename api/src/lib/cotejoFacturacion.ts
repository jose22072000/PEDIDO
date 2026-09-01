/**
 * Cotejar los pedidos contra la FACTURACIÓN de Ventra, y corregirlos.
 *
 * # El problema
 *
 * El pedido dice lo que el cliente pidió. La factura dice lo que se llevó, y no siempre
 * es lo mismo: falta existencia de algo, o el cliente cambia de idea delante del
 * mostrador. Hasta ahora eso no llegaba a ninguna parte: el vendedor veía su pedido tal
 * como lo tomó, y el pre-despacho cargaba el camión con la lista vieja. Al final del día,
 * descuadre.
 *
 * # Qué hace
 *
 * Cada pasada, por sucursal:
 *
 *   1. Trae lo facturado de los últimos días.
 *   2. Cruza cada pedido con su factura (por nombre de cliente, y línea por línea).
 *   3. Marca el pedido: `igual`, `cambiado` o `sin_factura`, con el número de factura.
 *   4. Si CAMBIÓ, reescribe las líneas del pedido con las de la factura —guardando las
 *      originales— para que lo que se despacha sea lo que se facturó.
 *   5. Y como el domicilio se cobra por peso, le pide a delivery el precio nuevo.
 *
 * # Por qué se corrige el pedido en vez de dejarlo como estaba
 *
 * Porque de él sale el pre-despacho. Si el cliente facturó otra cosa y el pedido sigue
 * diciendo lo de antes, el camión se carga con una lista y se cobra por otra. Lo que se
 * pidió NO se pierde: queda en `itemsOriginal`, y la pantalla lo enseña al lado.
 *
 * # Por qué aquí y no en delivery
 *
 * El pedido es de PEDIDO. Y a Entrega no se le puede avisar —es una APK que trabaja sin
 * conexión—, así que la corrección tiene que ocurrir del lado que siempre está en línea.
 * Delivery pone sólo lo suyo: la fórmula del domicilio, con los almacenes y la tarifa.
 */
import prisma from '../prismaClient';
import { databases, ventasDeSucursal, type LineaVentaVentra } from './ventra';
import { cotejar, type LineaFactura, type LineaPedido } from './cotejarFactura';
import { pesar, type FilaCatalogo } from './pesarFactura';
import { costoDomicilioDeDelivery } from './delivery';
import { emitEvent } from './events';

/** Cuántos días atrás se repasa. La facturación vieja ya no se mueve. */
const DIAS = Number(process.env.FACTURACION_DIAS || 3);
/** Cada cuánto. La facturación del día se mueve todo el rato. */
const CADA_MS = Number(process.env.FACTURACION_CADA_MS || 10 * 60 * 1000);

const soloFecha = (d: Date) => d.toISOString().slice(0, 10);

/** Mismo cruce de nombres que el sondeo del catálogo: los slugs de Ventra no se adivinan. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface ResultadoCotejo {
  sucursal: string;
  database: string;
  lineas: number;
  cotejados: number;
  igual: number;
  cambiado: number;
  sinFactura: number;
  /** A cuántos se les reescribieron las líneas con las de la factura. */
  corregidos: number;
  /** A cuántos se les rehizo el precio del domicilio. */
  recotizados: number;
  error?: string;
}

export async function cotejarUnaVez(): Promise<ResultadoCotejo[]> {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - DIAS * 86400000);
  const sucursales = await prisma.sucursal.findMany({ select: { id: true, nombre: true, codigo: true } });
  const bases = await databases();
  const salida: ResultadoCotejo[] = [];

  for (const suc of sucursales) {
    const clave = normalizar(suc.nombre);
    const base = bases.find((b) => normalizar(b.database) === clave || normalizar(b.branchName) === clave);
    const r: ResultadoCotejo = {
      sucursal: suc.nombre, database: base?.database || '', lineas: 0, cotejados: 0,
      igual: 0, cambiado: 0, sinFactura: 0, corregidos: 0, recotizados: 0,
    };

    if (!base) {
      r.error = `sin base en Ventra que cuadre con "${suc.nombre}"`;
      salida.push(r);
      continue;
    }

    try {
      const ventas = await ventasDeSucursal(base.database, soloFecha(desde), soloFecha(hasta));

      r.lineas = ventas.length;

      /**
       * Los pedidos de ESA sucursal y de ESOS días.
       *
       * La ventana es corta a propósito: cotejar el histórico entero contra la
       * facturación de tres días marcaría como «sin factura» cuarenta mil pedidos viejos
       * que nadie va a repartir.
       */
      const pedidos = await prisma.pedido.findMany({
        where: { sucursalId: suc.id, fecha: { gte: desde } },
        include: { items: true, cliente: true },
      });

      r.cotejados = pedidos.length;

      // El catálogo de la sucursal, una vez: hace falta para pesar lo facturado.
      const catalogo = await prisma.productoSucursal.findMany({
        where: { sucursalId: suc.id },
        select: { sku: true, nombre: true, pesoKg: true, categoria: true },
      });

      for (const p of pedidos) {
        const cambios = await cotejarUnPedido(p, ventas, catalogo, suc.codigo);

        if (cambios.estado === 'igual') r.igual++;
        else if (cambios.estado === 'cambiado') r.cambiado++;
        else r.sinFactura++;
        if (cambios.corregido) r.corregidos++;
        if (cambios.recotizado) r.recotizados++;
      }
    } catch (e) {
      // Una sucursal que falla no para las demás: puede ser que su base esté caída.
      r.error = (e as Error).message;
    }

    salida.push(r);
  }

  return salida;
}

type PedidoConItems = {
  id: string;
  folio: string;
  sucursalId: string | null;
  fecha: Date;
  costoDomicilio: number | null;
  facturaEstado: string | null;
  facturaNumero: string | null;
  itemsOriginal: string | null;
  items: Array<{ id: string; producto: string; codigo: string | null; unidades: number; packs: number | null; descripcion: string | null }>;
  encargado: string | null;
  cliente: { nombre: string; latitud: number | null; longitud: number | null } | null;
};

/**
 * Un pedido contra su factura: marcarlo, corregirlo y volver a ponerle precio al reparto.
 */
async function cotejarUnPedido(
  p: PedidoConItems,
  ventas: LineaVentaVentra[],
  catalogo: FilaCatalogo[],
  sucursalCodigo: string | null,
): Promise<{ estado: string; corregido: boolean; recotizado: boolean }> {
  /**
   * El mismo día o el SIGUIENTE.
   *
   * Se pide un día y se factura al otro, sobre todo lo de última hora. Mirando sólo el
   * mismo día, esos pedidos salían «sin facturar» aunque su factura existía. Y no se abre
   * más: con una ventana ancha, dos pedidos del mismo cliente en días seguidos se
   * cotejarían contra la factura del otro.
   */
  const dia = soloFecha(p.fecha);
  const siguiente = soloFecha(new Date(p.fecha.getTime() + 86400000));
  const suyas = ventas
    .filter((v) => {
      const f = soloFecha(new Date(v.fecha));

      return f === dia || f === siguiente;
    })
    .map<LineaFactura>((v) => ({
      operNumber: v.operNumber,
      clienteNombre: v.clienteNombre,
      productoCodigo: v.productoCodigo,
      productoNombre: v.productoNombre,
      cantidad: v.cantidad,
      precioUsd: v.precioUsd,
    }));

  // El nombre con el que Ventra factura. Cuando el pedido no tiene cliente de la lista,
  // el encargado es lo único que hay — y es lo que el facturador teclea.
  const nombreCliente = p.cliente?.nombre || p.encargado || '';
  const r = cotejar(p.items as LineaPedido[], suyas, nombreCliente);

  let corregido = false;
  let recotizado = false;
  const datos: Record<string, unknown> = {};

  if (p.facturaEstado !== r.estado || p.facturaNumero !== r.numero) {
    datos.facturaEstado = r.estado;
    datos.facturaNumero = r.numero;
    datos.facturaAt = new Date();
  }
  if (r.domicilioFacturado != null) datos.facturaDomicilio = r.domicilioFacturado;

  /**
   * Si la factura cambió el pedido, el pedido se rehace con lo facturado.
   *
   * Sólo una vez: `itemsOriginal` se escribe la primera vez y no se toca más. Si se
   * reescribiera en cada pasada, la segunda guardaría como «original» lo que ya era la
   * factura, y lo que pidió el cliente se perdería para siempre.
   */
  if (r.estado === 'cambiado' && r.lineas.length > 0 && !p.itemsOriginal) {
    await prisma.$transaction(async (tx) => {
      await tx.pedido.update({
        where: { id: p.id },
        data: {
          itemsOriginal: JSON.stringify(
            p.items.map((i) => ({
              producto: i.producto, codigo: i.codigo, unidades: i.unidades,
              packs: i.packs, descripcion: i.descripcion,
            })),
          ),
        },
      });
      await tx.pedidoItem.deleteMany({ where: { pedidoId: p.id } });
      await tx.pedidoItem.createMany({
        data: r.lineas.map((l) => ({
          pedidoId: p.id,
          producto: l.producto,
          codigo: l.codigo,
          /**
           * La cantidad de Ventra va en unidades de VENTA (el formato), que es lo que
           * aquí se llama `packs`. Se pone en los dos campos porque el precio y el peso
           * se calculan con `packs` cuando lo hay, y así una línea traída de la factura
           * cuenta igual que una tecleada.
           */
          unidades: Math.round(l.cantidad),
          packs: Math.round(l.cantidad),
        })),
      });
    });
    corregido = true;
  }

  /**
   * Y el domicilio, que se cobra por peso: si se lleva menos, cuesta menos.
   *
   * Se pesa lo que HAY AHORA en el pedido —que después de corregirlo es la factura— con
   * los pesos de Ventra, y se le pide el precio a delivery. Si falta el peso de alguna
   * línea no se pide nada: un precio calculado con la mitad de los kilos entra sin
   * protestar y pisa el que había, que sí estaba bien.
   */
  if (corregido && p.cliente?.latitud != null && p.cliente?.longitud != null && sucursalCodigo) {
    const peso = pesar(r.lineas, catalogo);

    if (peso != null) {
      const costo = await costoDomicilioDeDelivery({
        sucursalCodigo,
        lat: p.cliente.latitud,
        lng: p.cliente.longitud,
        pesoKg: peso,
      });

      if (costo && Math.abs(costo.usd - (p.costoDomicilio ?? -1)) > 0.01) {
        datos.costoDomicilio = costo.usd;
        recotizado = true;
      }
    }
  }

  if (Object.keys(datos).length > 0 || corregido) {
    if (Object.keys(datos).length > 0) await prisma.pedido.update({ where: { id: p.id }, data: datos });
    // Que se vea sin que nadie recargue.
    emitEvent('pedido', { id: p.id, sucursalId: p.sucursalId, accion: 'update' });
  }

  return { estado: r.estado, corregido, recotizado };
}

export function arrancarCotejoFacturacion(): void {
  if (!process.env.VENTRA_API_TOKEN && !process.env.WAREHOUSE_API_TOKEN) {
    console.log('[factura] sin token de Ventra: no se coteja la facturación');
    return;
  }

  const correr = () => {
    cotejarUnaVez()
      .then((rs) => {
        const ok = rs.filter((r) => !r.error);
        const mal = rs.filter((r) => r.error);
        const suma = (f: (r: ResultadoCotejo) => number) => ok.reduce((a, r) => a + f(r), 0);

        console.log(
          `[factura] ${suma((r) => r.cotejados)} pedidos cotejados · ` +
            `${suma((r) => r.igual)} igual, ${suma((r) => r.cambiado)} cambiados, ` +
            `${suma((r) => r.sinFactura)} sin factura · ` +
            `${suma((r) => r.corregidos)} corregidos, ${suma((r) => r.recotizados)} recotizados` +
            (mal.length ? ` · fallaron ${mal.map((r) => r.sucursal).join(', ')}` : ''),
        );
      })
      .catch((e) => console.error('[factura] cotejo falló:', (e as Error).message));
  };

  // Margen al arrancar, igual que el catálogo: durante el despliegue la VPN puede no
  // estar lista y un fallo en el primer segundo no dice nada.
  setTimeout(correr, 90_000);
  setInterval(correr, CADA_MS);
  console.log(`[factura] cotejo contra Ventra cada ${(CADA_MS / 60000).toFixed(0)} min`);
}
