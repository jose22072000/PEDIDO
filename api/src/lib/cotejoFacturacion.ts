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
 *   2. Cruza cada pedido con su factura por nombre de cliente, y línea por línea.
 *   3. Marca el pedido: `igual`, `cambiado` o `sin_factura`, con el número de factura.
 *   4. Guarda lo que dice la factura AL LADO, en `lineasFactura`.
 *
 * # El pedido NO se toca
 *
 * Hubo una versión que reescribía las líneas del pedido con las de la factura, para que
 * el pre-despacho cargara lo que de verdad sale. La idea era buena y la ejecución estaba
 * mal: el cotejo empareja por NOMBRE DE CLIENTE, así que un cliente con dos o tres
 * pedidos el mismo día tenía los tres comparados contra las MISMAS facturas, y los tres
 * acababan reescritos con lo mismo. En producción pasó con 40 de 207 facturas: el mismo
 * producto repetido en varios pedidos, uno completado y los otros en proceso.
 *
 * El dato que haría falta para repartir bien —qué factura salió de qué pedido— no existe
 * ni en el pedido ni en la factura. Así que el pedido se queda como lo tomó el vendedor,
 * que es la única versión de la que respondemos, y lo facturado se enseña al lado.
 *
 * Los pedidos que llegaron a reescribirse se DEVUELVEN a su estado original en la pasada
 * siguiente, desde la copia que quedó en `itemsOriginal`.
 *
 * # Por qué aquí y no en delivery
 *
 * El pedido es de PEDIDO, y a Entrega no se le puede preguntar nada: es una APK que
 * trabaja sin conexión. El cotejo tiene que ocurrir del lado que siempre está en línea.
 */
import prisma from '../prismaClient';
import { databases, ventasDeSucursal, type LineaVentaVentra } from './ventra';
import { cotejar, type LineaFactura, type LineaPedido } from './cotejarFactura';
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
  /** A cuántos se les DEVOLVIERON sus líneas originales, deshaciendo la reescritura vieja. */
  corregidos: number;
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
      igual: 0, cambiado: 0, sinFactura: 0, corregidos: 0,
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

      for (const p of pedidos) {
        const cambios = await cotejarUnPedido(p, ventas);

        if (cambios.estado === 'igual') r.igual++;
        else if (cambios.estado === 'cambiado') r.cambiado++;
        else r.sinFactura++;
        if (cambios.corregido) r.corregidos++;
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
): Promise<{ estado: string; corregido: boolean }> {
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
  const datos: Record<string, unknown> = {};

  if (p.facturaEstado !== r.estado || p.facturaNumero !== r.numero) {
    datos.facturaEstado = r.estado;
    datos.facturaNumero = r.numero;
    datos.facturaAt = new Date();
  }
  if (r.domicilioFacturado != null) datos.facturaDomicilio = r.domicilioFacturado;

  /**
   * La factura se GUARDA AL LADO. El pedido no se toca.
   *
   * # El error que esto corrige
   *
   * Antes, cuando la factura no cuadraba, se reescribían las líneas del pedido con las de
   * la factura. La idea era buena —que el pre-despacho cargue lo que de verdad sale— y la
   * ejecución estaba mal: el cotejo empareja por NOMBRE DE CLIENTE, así que cuando un
   * cliente tiene dos o tres pedidos el mismo día, los tres se comparan contra las MISMAS
   * facturas y los tres acababan reescritos con lo mismo. En producción pasó con 40 de
   * 207 facturas: el mismo producto repetido en varios pedidos, uno completado y los otros
   * en proceso, y a nadie le cuadraba nada.
   *
   * No hay forma de repartir bien esas facturas entre esos pedidos: el dato que haría
   * falta —qué factura salió de qué pedido— no está ni en el pedido ni en la factura.
   *
   * Así que el pedido se queda como lo tomó el vendedor, que es la única versión de la que
   * respondemos, y lo facturado se guarda aparte para poder verlo al lado y comparar.
   */
  if (r.lineas.length > 0) {
    datos.lineasFactura = JSON.stringify(r.lineas);
  }

  /**
   * Y se deshace lo que se llegó a reescribir.
   *
   * Los pedidos tocados guardaron sus líneas originales en `itemsOriginal`, así que se
   * pueden devolver tal cual. Se hace aquí, en la pasada normal, para que se arregle solo
   * en cuanto esto se despliegue y sin tener que entrar a la base a mano.
   */
  if (p.itemsOriginal) {
    try {
      const originales = JSON.parse(p.itemsOriginal) as Array<{
        producto: string; codigo: string | null; unidades: number; packs: number | null; descripcion: string | null;
      }>;

      if (Array.isArray(originales) && originales.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.pedidoItem.deleteMany({ where: { pedidoId: p.id } });
          await tx.pedidoItem.createMany({
            data: originales.map((l) => ({
              pedidoId: p.id,
              producto: l.producto,
              codigo: l.codigo ?? null,
              unidades: l.unidades,
              packs: l.packs ?? null,
              descripcion: l.descripcion ?? null,
            })),
          });
          // Se limpia para no volver a restaurar lo mismo en cada pasada.
          await tx.pedido.update({ where: { id: p.id }, data: { itemsOriginal: null } });
        });
        corregido = true;
      }
    } catch {
      // Un JSON ilegible no puede parar el cotejo del resto: se deja como está.
    }
  }

  /**
   * Y el domicilio, que se cobra por peso: si se lleva menos, cuesta menos.
   *
   * Se pesa lo que HAY AHORA en el pedido —que después de corregirlo es la factura— con
   * los pesos de Ventra, y se le pide el precio a delivery. Si falta el peso de alguna
   * línea no se pide nada: un precio calculado con la mitad de los kilos entra sin
   * protestar y pisa el que había, que sí estaba bien.
   */
  /**
   * El precio del domicilio ya NO se rehace desde aquí.
   *
   * Se recalculaba porque el pedido se reescribía con lo facturado y cambiaba de peso.
   * Ahora el pedido no se toca, así que su peso es el mismo y su precio también. Cuando
   * haga falta cobrar por lo facturado, se hará desde donde se decida esa correspondencia
   * —que hoy no se puede deducir— y no adivinando aquí.
   */

  if (Object.keys(datos).length > 0 || corregido) {
    if (Object.keys(datos).length > 0) await prisma.pedido.update({ where: { id: p.id }, data: datos });
    // Que se vea sin que nadie recargue.
    emitEvent('pedido', { id: p.id, sucursalId: p.sucursalId, accion: 'update' });
  }

  return { estado: r.estado, corregido };
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
            `${suma((r) => r.corregidos)} restaurados` +
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
