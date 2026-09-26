/**
 * Un pedido con TODO lo que hace falta para repartirlo, en una sola forma.
 *
 * Vive aquí y no dentro de una ruta porque sale por tres sitios y tiene que ser idéntico
 * en los tres:
 *
 *   GET /integration/orders        lo que el espejo se baja cuando pregunta.
 *   el webhook del reparto         lo que le mandamos sin que pregunte.
 *   (y lo que venga después)
 *
 * Que el aviso llevara sólo el id —«mira el pedido tal»— obligaba al reparto a volver a
 * preguntar por cada uno, que es media vuelta al problema que veníamos a quitar. Va
 * entero: pedido, cliente con sus coordenadas, vendedor con su cadena de mando, y las
 * líneas con sus pesos ya resueltos. Con eso el reparto guarda y arma la ruta sin
 * llamar a nadie.
 *
 * Lo que NO lleva es lo que no se puede congelar: el estado de la entrega lo escribe él.
 */
import prisma from '../prismaClient';
import { catalogosDeSucursales, unidadesDeVenta } from './catalogoSucursal';

/** Todo lo que hay que traer de la base para poder armar la forma de arriba. */
export const INCLUDE_COMPLETO = {

cliente: true,
sucursal: true,
items: true,
// La CADENA entera: pedido -> vendedor -> gestor -> sucursal.
//
// Antes se mandaba el pedido con su cliente y sus líneas y nada más, así que
// quien recibía esto no podía responder de quién es el pedido ni de qué
// sucursal sale: le llegaban vendedores, clientes y pedidos sueltos, todos al
// mismo nivel, sin nada que los uniera. La sucursal de un pedido se deriva
// vendedor -> gestor -> sucursal, y si no se manda el eslabón del medio, del
// otro lado hay que adivinarla.
vendedor: {
  select: {
    id: true, nombre: true, codigo: true, activo: true, sucursalId: true,
    gestor: {
      select: {
        id: true, username: true, sucursalId: true,
        sucursal: { select: { codigo: true, nombre: true } },
      },
    },
  },
},
} as const;

/**
 * Las líneas de la FACTURA de un pedido, en la misma forma que las del pedido.
 *
 * `lineasFactura` se guarda como texto —lo escribe el cotejo— y trae las líneas ya
 * enriquecidas: producto, código, cantidad en unidades de venta, unidades y peso.
 *
 * # Lo que se descarta
 *
 * Las marcadas `falta` NO van. Son productos que se pidieron y **no se facturaron**: están
 * ahí para pintarlas en la pantalla del pedido, porque que algo desaparezca es justo lo
 * que la gente abre a mirar. Pero no hay nada que subir al camión, y mandarlas haría que
 * el repartidor cargara un hueco.
 *
 * # Devuelve null, no una lista vacía
 *
 * `null` significa «este pedido no tiene factura, usa las del pedido». Una lista vacía
 * significaría «la factura no llevaba nada», que es otra cosa y no se debe confundir: un
 * pedido facturado a cero no se reparte, y uno sin cotejar todavía sí, con lo que se pidió.
 */
function lineasDeFactura(p: { lineasFactura?: string | null }): Array<{
  producto: string;
  codigo: string | null;
  unidades: number | null;
  packs: number | null;
  descripcion: string | null;
}> | null {
  if (!p.lineasFactura) return null;

  try {
    const crudas = JSON.parse(p.lineasFactura) as Array<{
      producto?: string;
      codigo?: string | null;
      cantidad?: number;
      unidades?: number | null;
      marca?: string;
    }>;

    if (!Array.isArray(crudas)) return null;

    const lineas = crudas
      .filter((l) => l && l.marca !== 'falta' && typeof l.producto === 'string')
      .map((l) => ({
        producto: String(l.producto),
        codigo: l.codigo ?? null,
        // En la factura, `cantidad` son unidades de VENTA —cajas, blísteres—, que es lo
        // que el pedido llama `packs`. Llamarlas igual evita que del otro lado alguien
        // multiplique dos veces.
        packs: typeof l.cantidad === 'number' ? l.cantidad : null,
        unidades: typeof l.unidades === 'number' ? l.unidades : null,
        descripcion: null as string | null,
      }));

    return lineas.length ? lineas : null;
  } catch {
    // Un JSON ilegible no puede dejar el pedido sin líneas: se cae a las del pedido, que
    // es lo que había antes de que existiera el cotejo.
    return null;
  }
}

/**
 * Pasa los pedidos de la base a la forma de la integración.
 *
 * `catalogos` viene de fuera —de `catalogosDeSucursales`— para poder cargar de una vez
 * los de toda una página en vez de uno por pedido.
 */
export function mapearParaIntegracion(pedidos: any[], catalogos: Map<string, any>) {
  const filaDe = (sucursalId: string | null, producto: string | null) =>
    sucursalId ? catalogos.get(sucursalId)?.buscar(producto) : undefined;

  return pedidos.map((p: any) => ({
    id: p.id,
    folio: p.folio,
    /**
     * El cliente y el vendedor TAMBIÉN planos, además de dentro de sus objetos.
     *
     * Es lo que hace falta para desempatar un folio repetido, y quien lo necesita no
     * puede ir a buscarlo anidado: la APK de domicilio casa su `numero_pedido` con un
     * LIKE —el sufijo `-1`, `-2` lo ponemos nosotros y ella no lo ve— así que un folio
     * le devuelve varios pedidos, de CLIENTES DISTINTOS y con facturas distintas. Son
     * 2.560 desde agosto.
     *
     * Sin estos dos campos a mano, elegir entre esos hermanos es una moneda al aire, y
     * lo que se elige mal es a quién se le cobra el domicilio. Ver `folioDeLaNota` y el
     * error de julio.
     *
     * Van duplicados a propósito: `cliente` y `vendedor` completos siguen ahí y nadie
     * tiene que cambiar nada.
     */
    clienteCodigo: p.cliente?.codigo ?? null,
    vendedorCodigo: p.vendedor?.codigo ?? null,
    sucursalId: p.sucursalId,
    sucursalCodigo: p.sucursal?.codigo || null,
    sucursalNombre: p.sucursal?.nombre || null,
    direccion: p.direccion,
    encargado: p.encargado,
    telefono: p.telefono,
    fecha: p.fecha,
    fechaComprometida: p.fecha_comprometida,
    estado: p.estado,
    /**
     * Archivado y completado, que hasta ahora no salían.
     *
     * En PEDIDO archivar es un borrado blando: los completados y los expirados viejos se
     * ocultan de la lista y se guardan para los informes. Son 51.871 de 56.208 — la
     * inmensa mayoría—, así que quien recibe esto sin el dato no puede distinguir un
     * pedido vivo de uno de hace ocho meses, y los mezcla todos en la misma lista.
     *
     * `expirado` no es una columna: es que la fecha comprometida ya pasó y no se completó.
     * Se calcula aquí y no allí, para que la regla viva en un solo sitio.
     */
    archivado: p.archivedAt != null,
    archivadoEn: p.archivedAt,
    completadoEn: p.completedAt,
    expirado:
      p.estado !== 'completada' && p.fecha_comprometida != null && p.fecha_comprometida < new Date(),
    pedidoCobrado: p.pedido_cobrado,
    requiereDomicilio: p.requiere_domicilio,
    costoDomicilio: p.costoDomicilio,
    /**
     * Y CÓMO QUEDÓ FRENTE A LA FACTURA, que es lo que el vendedor no podía saber.
     *
     * Sale por aquí y no sólo en pantalla porque quien más lo necesita es la tablet: el
     * vendedor ve el pedido tal como lo tomó, y con esto ve además si llegó a facturarse
     * y con qué número. Va con `since=` como todo lo demás, así que enterarse cuesta una
     * llamada corta y no bajarse el día entero por datos móviles.
     */
    facturaEstado: p.facturaEstado,
    facturaNumero: p.facturaNumero,
    facturaAt: p.facturaAt,
    facturaDomicilio: p.facturaDomicilio,
    /**
     * Y si el pedido CUADRA porque se corrigió, o porque vino bien.
     *
     * Los dos quedan en `facturaEstado: 'igual'` y se pueden repartir, pero no son lo
     * mismo, y quien lo mira tiene derecho a saber cuál es cuál. Sin esto, el vendedor ve
     * en su tablet unas cantidades distintas de las que tomó y no hay nada que se lo
     * explique.
     */
    facturaCorregidoAt: p.facturaCorregidoAt,
    facturaDiferencias: p.facturaDiferencias,
    /**
     * Y EN QUÉ PUNTO DEL REPARTO está. Lo escribe delivery, que es quien lo sabe.
     *
     * Va aparte de `estado`: un pedido puede estar completado en PEDIDO y todavía dando
     * vueltas en el camión, y las dos cosas hay que poder decirlas.
     */
    estadoEntrega: p.estadoEntrega,
    estadoEntregaAt: p.estadoEntregaAt,
    estadoEntregaNota: p.estadoEntregaNota,
    /** Lo que dice la FACTURA, al lado del pedido. JSON en texto, o nulo. */
    lineasFactura: p.lineasFactura,
    // Para que la tablet sepa por dónde seguir: se guarda el mayor de la tanda y se
    // manda como `since` en la siguiente sync.
    updatedAt: p.updatedAt,
    // De quién es el pedido, con su cadena de mando. `sucursalCodigo` de aquí abajo
    // es de dónde cuelga el VENDEDOR; el de arriba es el del pedido. Casi siempre son
    // el mismo, y cuando no lo son es justo lo que hay que mirar.
    vendedor: p.vendedor
      ? {
          id: p.vendedor.id,
          codigo: p.vendedor.codigo,
          nombre: p.vendedor.nombre,
          activo: p.vendedor.activo,
          sucursalId: p.vendedor.sucursalId,
          gestor: p.vendedor.gestor
            ? {
                id: p.vendedor.gestor.id,
                usuario: p.vendedor.gestor.username,
                sucursalId: p.vendedor.gestor.sucursalId,
                sucursalCodigo: p.vendedor.gestor.sucursal?.codigo ?? null,
                sucursalNombre: p.vendedor.gestor.sucursal?.nombre ?? null,
              }
            : null,
        }
      : null,
    cliente: clienteParaIntegracion(p.cliente),
    /**
     * DE DÓNDE SALEN LAS LÍNEAS: de la factura si la hay, del pedido si no.
     *
     * Lo que sube al camión es lo que se facturó, no lo que se pidió. El cliente pide
     * veinte cajas y se lleva quince: repartir por el pedido es cargar cinco de más y
     * descuadrar la caja.
     *
     * PEDIDO guarda lo facturado aparte, en `lineasFactura`, y sólo reescribe el pedido si
     * `CORREGIR_DESDE_FACTURA` está encendido — y está apagado a propósito. Así que aquí se
     * traduce al vuelo: el pedido en PEDIDO se queda como lo tomó el vendedor, y quien
     * reparte recibe lo que de verdad salió.
     */
    itemsOrigen: lineasDeFactura(p) ? 'factura' : 'pedido',
    items: (lineasDeFactura(p) ?? p.items).map((i) => {
      const fila = filaDe(p.sucursalId, i.producto);
      /**
       * DOS pesos, y con nombres que dicen cuál es cuál.
       *
       * El peso de Ventra es POR UNIDAD DE VENTA (el blíster, la caja), igual que el
       * precio. Mandar sólo ése y llamarlo "el peso de la línea" —como decía este
       * comentario— es pedirle a quien recibe que se acuerde de multiplicar por
       * `packs`, y el día que se olvide el domicilio sale dividido entre veinticuatro
       * sin que falle nada.
       *
       *   pesoKg       -> lo que pesa UNA unidad de venta.
       *   pesoLineaKg  -> lo que pesa la línea entera (unidades de venta × pesoKg).
       *
       * `null` en los dos significa que ese producto no está en el catálogo de esa
       * sucursal ahora mismo, no que falte el dato: la línea se manda igual.
       */
      const pesoKg = fila?.pesoKg ?? null;
      const cantidad = unidadesDeVenta(i.packs, i.unidades);

      return {
        codigo: i.codigo,
        producto: i.producto,
        unidades: i.unidades,
        packs: i.packs,
        descripcion: i.descripcion,
        pesoKg,
        pesoLineaKg: pesoKg != null ? Number((pesoKg * cantidad).toFixed(3)) : null,
      };
    }),
  }));
}

/**
 * UN pedido, entero, por su id. Es lo que se le mete al webhook del reparto.
 *
 * Devuelve `null` si no está —lo borraron mientras el aviso hacía cola—, y quien llama
 * decide qué hacer con eso: para un borrado, mandar el aviso a secas es lo correcto.
 */
export async function pedidoCompletoPorId(id: string): Promise<Record<string, unknown> | null> {
  const p = await prisma.pedido.findUnique({ where: { id }, include: INCLUDE_COMPLETO as any });

  if (!p) return null;

  const catalogos = await catalogosDeSucursales(p.sucursalId ? [p.sucursalId] : []);

  return mapearParaIntegracion([p], catalogos)[0] as Record<string, unknown>;
}

/**
 * El cliente, con DÓNDE ESTÁ.
 *
 * La misma forma dentro del pedido y suelto, para que el reparto guarde lo mismo por los
 * dos caminos. Si salieran dos formas, el cliente que llega con el pedido y el que llega
 * cuando se mueve se pisarían uno a otro y se perdería el que trajera menos campos.
 */
export function clienteParaIntegracion(c: any): Record<string, unknown> | null {
  if (!c) return null;

  return {
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    zona: c.zona,
    direccion: c.direccion,
    municipio: c.municipio,
    tipoCliente: c.tipoCliente,
    estadoCompra: c.estadoCompra,
    latitud: c.latitud,
    longitud: c.longitud,
    geolocalizacion: c.geolocalizacion,
    // De DÓNDE salen esas coordenadas y de cuándo son. Sin esto, el reparto no puede
    // decidir entre lo que tiene guardado y lo que le llega: no sabe cuál es más nuevo
    // ni cuál la puso un repartidor con el cliente delante.
    geoFuente: c.geoFuente ?? null,
    geoAt: c.geoAt ?? null,
    sucursalId: c.sucursalId ?? null,
  };
}

/** UN cliente, entero, por su id. Es lo que va en el aviso de «se movió». */
export async function clienteCompletoPorId(id: string): Promise<Record<string, unknown> | null> {
  return clienteParaIntegracion(await prisma.cliente.findUnique({ where: { id } }));
}
