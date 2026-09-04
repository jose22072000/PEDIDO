/**
 * Cotejar los pedidos contra la FACTURACIÓN de Ventra, y corregirlos.
 *
 * # El problema
 *
 * El pedido dice lo que el cliente pidió. La factura dice lo que se llevó, y no siempre es
 * lo mismo: falta existencia de algo, o el cliente cambia de idea delante del mostrador.
 * Eso no llegaba a ninguna parte: el vendedor veía su pedido tal como lo tomó y el
 * pre-despacho cargaba el camión con la lista vieja. Al final del día, descuadre.
 *
 * # Qué hace
 *
 * Cada diez minutos, sucursal por sucursal:
 *
 *   1. Trae lo facturado de los últimos días.
 *   2. Ata cada factura a SU pedido por el folio que Ventra escribe en la nota.
 *   3. Compara línea por línea: `igual`, `cambiado` o `sin_factura`.
 *   4. Si cambió, **reescribe el pedido con lo facturado** y guarda lo que el vendedor
 *      había tomado en `itemsOriginal`.
 *   5. Y se lo cuenta a Entrega, si ese pedido ya tenía precio de domicilio puesto.
 *
 * # Por qué ahora sí se corrige, si ya salió mal una vez
 *
 * La versión de julio emparejaba por NOMBRE DE CLIENTE. Un cliente con dos pedidos el
 * mismo día tenía los dos comparados contra las mismas facturas y los dos acababan
 * reescritos con lo mismo: pasó con 40 de 207 facturas, unos pedidos completados y otros
 * en proceso, y a nadie le cuadraba nada. Se revirtió.
 *
 * Lo que faltaba era saber QUÉ FACTURA SALIÓ DE QUÉ PEDIDO, y ese dato ya existe:
 * `emparejarFactura` lo lee del folio que la nota de Ventra lleva escrito
 * (`P-PRM25-260901-1808-3`), porque el operador lo copia de la pantalla de PEDIDO al
 * facturar. Aquí llegan sólo las facturas de ESTE pedido. No se adivina nada.
 *
 * # Lo que NO se toca
 *
 * Las facturas sin folio en la nota no se emparejan con nadie, a propósito. Son ventas
 * libres —el cliente llegó sin pedido y se le vendió en el mostrador— y no tienen pedido
 * detrás. Atarlas a uno por parecido sería inventar.
 *
 * # Se apaga con una variable
 *
 * `CORREGIR_DESDE_FACTURA=false` y todo vuelve a como estaba: los pedidos corregidos se
 * devuelven solos a su versión original desde `itemsOriginal`, en la pasada siguiente. No
 * hace falta desplegar para revertir, que es lo que se quiere de algo que ya falló una vez.
 *
 * # Por qué aquí y no en delivery
 *
 * El pedido es de PEDIDO, y a Entrega no se le puede preguntar nada: es una APK que
 * trabaja sin conexión. El cotejo tiene que ocurrir del lado que siempre está en línea.
 */
import prisma from '../prismaClient';
import { databases, ventasDeSucursal, type LineaVentaVentra } from './ventra';
import {
  cotejar,
  unidadesPorFormato,
  type Cotejo,
  type LineaFactura,
  type LineaPedido,
} from './cotejarFactura';
import { facturasPorFolio } from './emparejarFactura';
import { catalogoDeSucursal, type CatalogoSucursal } from './catalogoSucursal';
import { emitEvent } from './events';
import { avisarPedidoCambiado } from './webhook';

/** Cuántos días atrás se repasa. La facturación vieja ya no se mueve. */
const DIAS = Number(process.env.FACTURACION_DIAS || 3);
/** Cada cuánto. La facturación del día se mueve todo el rato. */
const CADA_MS = Number(process.env.FACTURACION_CADA_MS || 10 * 60 * 1000);

const soloFecha = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Si el pedido se corrige con lo que dice la factura.
 *
 * **APAGADO por defecto, y a propósito.**
 *
 * Esto ya se desplegó una vez encendido y salió mal: la misma factura acabó copiada en 40
 * de 207 pedidos. Ahora empareja por folio y no puede repetirse, pero un código que
 * reescribe pedidos de producción no entra encendido el día que se despliega. Entra
 * inerte, alguien mira una pasada del cotejo, y entonces se enciende.
 *
 * Se enciende con `CORREGIR_DESDE_FACTURA=true`. Apagarlo después devuelve solos todos
 * los pedidos corregidos a como los tomó el vendedor, desde `itemsOriginal`, en la pasada
 * siguiente — así que la marcha atrás es una variable y no un despliegue.
 */
const CORREGIR = process.env.CORREGIR_DESDE_FACTURA === 'true';

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

/**
 * Una pasada del cotejo.
 *
 * @param rapido  el CARRIL RÁPIDO: sólo lo de hoy y sólo las sucursales que tienen algún
 *                pedido esperando factura. Ver `arrancarCotejoFacturacion`.
 */
export async function cotejarUnaVez(rapido = false): Promise<ResultadoCotejo[]> {
  const hasta = new Date();
  const desde = rapido
    ? new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
    : new Date(hasta.getTime() - DIAS * 86400000);
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
      /**
       * EN EL CARRIL RÁPIDO, PRIMERO SE MIRA SI HAY A QUIÉN ESPERAR.
       *
       * Preguntar antes a nuestra propia base cuesta una consulta; preguntarle a Ventra
       * cuesta una vuelta por la VPN. Corriendo cada medio minuto, sondear las ocho
       * sucursales sin tener un solo pedido pendiente sería castigar a Ventra todo el día
       * para no enterarse de nada.
       *
       * Se cuentan los que TODAVÍA no tienen factura. En cuanto a uno le sale, la pasada
       * completa —la de cada diez minutos— se ocupa de lo demás.
       */
      if (rapido) {
        const esperando = await prisma.pedido.count({
          where: {
            sucursalId: suc.id,
            fecha: { gte: desde },
            OR: [{ facturaEstado: null }, { facturaEstado: 'sin_factura' }],
          },
        });

        if (esperando === 0) {
          salida.push(r);
          continue;
        }
      }

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

      /**
       * Qué factura es de qué pedido, por el FOLIO que llevan escrito en la nota.
       *
       * Se calcula una vez para toda la sucursal. Sin esto había que adivinar por nombre
       * de cliente, y adivinando acabó la misma factura pegada a dos pedidos distintos.
       */
      const porFolio = facturasPorFolio(ventas);

      /**
       * El catálogo de la sucursal, UNA vez para todos sus pedidos.
       *
       * De aquí sale el peso de cada línea facturada. Pedirlo por pedido serían
       * doscientas consultas para el mismo dato. Si falla, las líneas se quedan sin peso
       * y el cotejo sigue: el peso es para enseñarlo, no para decidir nada.
       */
      let catalogo: CatalogoSucursal | null = null;

      try {
        catalogo = await catalogoDeSucursal(suc.id);
      } catch {
        catalogo = null;
      }

      for (const p of pedidos) {
        const suyas = porFolio.get(p.folio.toUpperCase());
        const cambios = await cotejarUnPedido(p, suyas ? ventas.filter((v) => suyas.has(v.operNumber)) : [], catalogo);

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

/**
 * Rellenar las líneas de la factura con lo mismo que se enseña del pedido.
 *
 * La factura de Ventra sólo trae formatos y precio. Las UNIDADES y los KILOS hay que
 * componerlos, y se hace aquí porque es donde están las dos cosas que hacen falta: el
 * pedido —de donde sale cuántas unidades trae un formato— y el catálogo de la sucursal,
 * que es de donde sale el peso.
 *
 * Lo que no se puede saber se queda en **nulo**, nunca en cero: un producto que no estaba
 * en el pedido no tiene de dónde deducir su formato, y uno que no está en el catálogo no
 * tiene peso. La pantalla pinta el nulo como «—»; un cero se lee como «no pesa» y es
 * mentira.
 */
/**
 * Lo que se guarda para PINTAR la factura al lado del pedido: sus líneas, ya marcadas
 * como iguales, cambiadas o añadidas, y al final lo que se pidió y no llegó a
 * facturarse.
 *
 * Los faltantes no van en `r.lineas` a propósito —esa lista es la que reescribe el
 * pedido cuando se corrige, y un producto de cero formatos ahí acabaría en el camión—,
 * pero en la pantalla hacen falta: que un producto desapareciera es justo lo que la
 * gente abre el pedido a mirar. Se pegan aquí, con `marca: 'falta'`, y quien los pinta
 * los distingue por esa marca.
 */
function paraPintar(r: Cotejo): unknown[] {
  return [
    ...r.lineas,
    ...r.faltantes.map((f) => ({
      producto: f.producto,
      codigo: null,
      cantidad: 0,
      unidades: null,
      pesoKg: null,
      importe: null,
      marca: 'falta',
      pedido: f.pedido,
    })),
  ];
}

function enriquecerLineas(
  lineas: Cotejo['lineas'],
  items: PedidoConItems['items'],
  catalogo: CatalogoSucursal | null,
): void {
  // Cuántas unidades trae un formato, según lo que el vendedor tomó de ESE producto.
  const porFormato = new Map<string, number>();

  for (const it of items) {
    const packs = Number(it.packs) || 0;
    const unidades = Number(it.unidades) || 0;

    if (packs > 0 && unidades > 0) porFormato.set(normalizar(it.producto), unidades / packs);
  }

  for (const l of lineas) {
    const clave = normalizar(l.producto);
    const razon = porFormato.get(clave);

    /**
     * Primero la proporción del propio pedido, que es la verdad de ESE producto. Si no
     * está —porque la factura lo trae y el pedido no—, se lee del nombre: casi siempre
     * lo dice, «CAJA 24U», «BLISTER 6U», «PACA 12P DE 4U».
     */
    const porUnidad = razon ?? unidadesPorFormato(l.producto);

    if (porUnidad) l.unidades = Math.round(l.cantidad * porUnidad);

    const fila = catalogo?.buscar(l.producto);

    if (fila?.pesoKg) l.pesoKg = Number((fila.pesoKg * l.cantidad).toFixed(3));
  }
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
 * Un pedido contra SU factura.
 *
 * Las que llegan aquí ya vienen filtradas por FOLIO: son las facturas cuya nota nombra a
 * este pedido y a ningún otro. Aquí no se elige nada — antes sí se elegía, por nombre de
 * cliente y por fecha, y así acabó la misma factura pegada a dos pedidos distintos.
 */
async function cotejarUnPedido(
  p: PedidoConItems,
  ventas: LineaVentaVentra[],
  catalogo: CatalogoSucursal | null = null,
): Promise<{ estado: string; corregido: boolean }> {
  const suyas = ventas.map<LineaFactura>((v) => ({
    operNumber: v.operNumber,
    clienteNombre: v.clienteNombre,
    productoCodigo: v.productoCodigo,
    productoNombre: v.productoNombre,
    cantidad: v.cantidad,
    precioUsd: v.precioUsd,
  }));

  const r = cotejar(p.items as LineaPedido[], suyas);

  enriquecerLineas(r.lineas, p.items, catalogo);

  let corregido = false;
  const datos: Record<string, unknown> = {};

  // Si el cotejo dice algo DISTINTO de lo que había guardado. Se mira aquí y se guarda
  // en una variable porque también decide a quién hay que avisar: sin eso, cada pasada
  // volvería a avisar de lo mismo cada diez minutos.
  const cotejoNuevo = p.facturaEstado !== r.estado || p.facturaNumero !== r.numero;

  if (cotejoNuevo) {
    datos.facturaEstado = r.estado;
    datos.facturaNumero = r.numero;
    datos.facturaAt = new Date();
  }
  if (r.domicilioFacturado != null) datos.facturaDomicilio = r.domicilioFacturado;

  /**
   * Y AQUÍ SE CORRIGE EL PEDIDO CON LO QUE DICE LA FACTURA.
   *
   * # Por qué
   *
   * El cliente pide veinte cajas y se lleva quince. El pedido dice lo que pidió; lo que
   * sale en el camión y lo que se cobra es lo facturado. Repartir por el pedido viejo es
   * cargar de más y descuadrar la caja, y hasta ahora eso lo tenía que arreglar el
   * vendedor a mano, pedido por pedido — que es justo lo que no se quería.
   *
   * # Por qué AHORA sí, si ya salió mal una vez
   *
   * La versión de julio emparejaba por NOMBRE DE CLIENTE. Un cliente con dos pedidos el
   * mismo día tenía los dos comparados contra las mismas facturas, y los dos acababan
   * reescritos con lo mismo: pasó con 40 de 207 facturas.
   *
   * Ya no se adivina. `emparejarFactura` ata cada factura a UN pedido por el folio que
   * Ventra escribe en la nota (`P-PRM25-260901-1808-3`), y aquí llegan sólo las de ESTE
   * pedido. Lo que faltaba para poder hacer esto era ese dato, y ya existe.
   *
   * # Las tres condiciones, todas
   *
   *  - Hay factura y dice algo distinto (`cambiado`).
   *  - Se sabe QUÉ productos: sin líneas no hay con qué reescribir.
   *  - Está encendido. Se apaga con `CORREGIR_DESDE_FACTURA=false` y todo vuelve a como
   *    estaba, sin desplegar.
   *
   * # Lo que el vendedor tomó no se pierde
   *
   * Se guarda entero en `itemsOriginal` la primera vez, y sólo la primera: si se guardara
   * en cada pasada, la segunda machacaría el original con la versión ya corregida y no
   * quedaría contra qué comparar. De ahí sale poder decir qué cambió, y poder deshacerlo.
   */
  const seCorrige =
    CORREGIR &&
    r.estado === 'cambiado' &&
    r.lineas.length > 0 &&
    /**
     * Y sólo si de verdad hay una factura atada a ESTE pedido.
     *
     * `r.numero` viene de las facturas que el folio ató. Sin número no se sabe de dónde
     * salieron esas líneas, y reescribir un pedido con algo de procedencia desconocida es
     * exactamente el error de julio.
     */
    !!r.numero;

  if (seCorrige) {
    /**
     * Cuántas unidades trae cada unidad de venta, para no perder ese dato al reescribir.
     *
     * En el pedido, `packs` son las cajas y `unidades` el total: 10 pacas de arroz son
     * 100 kg. Ventra factura en cajas, así que las unidades hay que reconstruirlas. Se
     * usa la proporción que ya tenía ESA línea del pedido; para un producto que no
     * estaba pedido no hay proporción que copiar y se deja igual a las cajas, que es lo
     * único que se sabe con certeza.
     */
    const porUnidad = new Map<string, number>();

    for (const it of p.items) {
      const packs = Number(it.packs) || 0;
      const unidades = Number(it.unidades) || 0;

      if (packs > 0 && unidades > 0) porUnidad.set(normalizar(it.producto), unidades / packs);
    }

    const nuevas = r.lineas.map((l) => {
      const razon = porUnidad.get(normalizar(l.producto)) ?? 1;

      return {
        pedidoId: p.id,
        producto: l.producto,
        codigo: l.codigo ?? null,
        packs: l.cantidad,
        unidades: Math.round(l.cantidad * razon),
        descripcion: null as string | null,
      };
    });

    await prisma.$transaction(async (tx) => {
      // El original, sólo la primera vez. Ver arriba.
      if (!p.itemsOriginal) {
        await tx.pedido.update({
          where: { id: p.id },
          data: { itemsOriginal: JSON.stringify(p.items) },
        });
      }
      await tx.pedidoItem.deleteMany({ where: { pedidoId: p.id } });
      await tx.pedidoItem.createMany({ data: nuevas });
    });

    /**
     * Y a partir de ahora el pedido CUADRA, porque es la factura.
     *
     * Es lo que permite repartirlo: en una ruta sólo entra lo facturado y que cuadre.
     * `facturaCorregidoAt` deja dicho que cuadra porque se corrigió y no porque viniera
     * bien — sin esa marca no habría forma de distinguir las dos cosas después.
     */
    datos.facturaEstado = 'igual';
    datos.facturaCorregidoAt = new Date();
    datos.lineasFactura = JSON.stringify(paraPintar(r));
    datos.facturaDiferencias = JSON.stringify(r.diferencias);
    corregido = true;
  } else if (r.lineas.length > 0) {
    // Sin corregir, lo facturado se guarda AL LADO para poder verlo y compararlo.
    datos.lineasFactura = JSON.stringify(paraPintar(r));
    if (r.diferencias.length > 0) datos.facturaDiferencias = JSON.stringify(r.diferencias);
  }

  /**
   * Y si se apaga el interruptor, los pedidos corregidos VUELVEN a como los tomó el
   * vendedor. Solos, en la pasada siguiente.
   *
   * Es lo que hace que apagar `CORREGIR_DESDE_FACTURA` sea una marcha atrás de verdad y
   * no un «deja de corregir a partir de ahora», que dejaría media producción reescrita y
   * la otra media no. `itemsOriginal` se limpia al restaurar para no repetirlo cada diez
   * minutos.
   */
  if (!CORREGIR && p.itemsOriginal) {
    try {
      const originales = JSON.parse(p.itemsOriginal) as PedidoConItems['items'];

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
          await tx.pedido.update({
            where: { id: p.id },
            data: { itemsOriginal: null, facturaCorregidoAt: null },
          });
        });
        corregido = true;
      }
    } catch {
      // Un JSON ilegible no puede parar el cotejo del resto: se deja como está.
    }
  }

  if (Object.keys(datos).length > 0 || corregido) {
    if (Object.keys(datos).length > 0) await prisma.pedido.update({ where: { id: p.id }, data: datos });
    // Que se vea sin que nadie recargue.
    emitEvent('pedido', { id: p.id, sucursalId: p.sucursalId, accion: 'update' });
  }

  /**
   * Y SE LE CUENTA A ENTREGA, que ya le había puesto precio a otra cosa.
   *
   * La APK cotizó el domicilio de un pedido que pesaba veinte cajas y ahora pesa quince.
   * No se le puede preguntar —trabaja sin conexión—, así que hay que avisarle.
   *
   * **Sólo si ese pedido YA tiene costo de domicilio puesto.** Si todavía no lo ha
   * cotizado no hay nada que corregir: cuando le llegue por el camino normal ya vendrá
   * con lo facturado, y avisarle de un cambio sobre algo que nunca vio es ruido. Y si el
   * pedido no lleva domicilio, tampoco: no hay precio que rehacer.
   *
   * # Y también cuando NO se reescribe el pedido
   *
   * Antes esto colgaba sólo de `seCorrige`, o sea de que el interruptor de corregir
   * estuviera encendido — y está apagado. El resultado era que la factura podía traer
   * treinta kilos más que el pedido y a Entrega no se le decía nada: seguía cobrando el
   * reparto de un peso que ya no existe.
   *
   * Que el pedido se reescriba o no es una decisión nuestra sobre qué lista sube al
   * camión. El peso cambió igual. Así que se avisa cuando el cotejo pasa a «cambiado»,
   * se corrija o no.
   *
   * `cotejoNuevo` es lo que impide que esto se convierta en un aviso cada diez minutos:
   * sólo se manda cuando el cotejo dice algo distinto de lo que ya estaba guardado.
   */
  if ((seCorrige || (cotejoNuevo && r.estado === 'cambiado')) && p.costoDomicilio != null) {
    await avisarPedidoCambiado(p.id).catch((e) =>
      console.warn(`[factura] no se pudo avisar a Entrega del pedido ${p.folio}:`, (e as Error).message),
    );
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

  /**
   * EL CARRIL RÁPIDO: enterarse de la factura en segundos, no en diez minutos.
   *
   * # Por qué hacen falta dos relojes
   *
   * Cuando la factura sale distinta del pedido, el reparto que la APK de Entrega ya
   * había cotizado deja de valer: se calculó sobre un peso que no es el que va a subir
   * al camión. Ese aviso tiene que llegarle a Entrega mientras el pedido todavía está en
   * el mostrador, no diez minutos después, cuando el camión ya salió.
   *
   * La pasada completa no se puede acelerar sin más: son mil cuatrocientos pedidos de
   * tres días por ocho sucursales, con su catálogo y sus correcciones. Corriéndola cada
   * treinta segundos se pasaría el día entero cotejando lo mismo.
   *
   * # Qué hace el rápido, entonces
   *
   * Sólo HOY, y sólo las sucursales que tienen algún pedido esperando factura. La
   * mayoría de las vueltas no llegan ni a preguntarle a Ventra: cuentan en nuestra base,
   * ven que no hay nadie esperando y se van. Cuando sí hay alguien, se coteja esa
   * sucursal y, si la factura cambió el pedido, el aviso a Entrega sale ahí mismo.
   *
   * Lo demás —el histórico de tres días, las restauraciones, los pedidos viejos que
   * cambian tarde— sigue siendo cosa de la pasada completa.
   */
  const RAPIDO_MS = Number(process.env.FACTURACION_RAPIDO_MS || 30_000);

  /**
   * El recuento de la vuelta anterior, para no repetir la misma línea cada treinta
   * segundos.
   *
   * El rápido vuelve a cotejar los mismos pedidos de hoy una y otra vez, así que sus
   * totales son casi siempre idénticos. Escribiéndolos siempre, el registro se llena de
   * dos mil líneas al día que dicen lo mismo y la que importa —la factura que acaba de
   * entrar— se pierde entre ellas. Se escribe sólo cuando el número SE MUEVE, que es
   * justo cuando ha pasado algo.
   */
  let ultimo = '';

  const correrRapido = () => {
    cotejarUnaVez(true)
      .then((rs) => {
        const cambiados = rs.reduce((a, r) => a + (r.error ? 0 : r.cambiado), 0);
        const nuevos = rs.reduce((a, r) => a + (r.error ? 0 : r.igual), 0);
        const ahora = `${nuevos}/${cambiados}`;

        if (ahora !== ultimo) {
          console.log(`[factura/rápido] hoy: ${nuevos} igual, ${cambiados} cambiados`);
          ultimo = ahora;
        }
      })
      .catch((e) => console.error('[factura/rápido] falló:', (e as Error).message));
  };

  // Margen al arrancar, igual que el catálogo: durante el despliegue la VPN puede no
  // estar lista y un fallo en el primer segundo no dice nada.
  setTimeout(correr, 90_000);
  setInterval(correr, CADA_MS);
  // El rápido arranca desfasado, para no coincidir con la pasada completa y pedirle a
  // Ventra dos cosas a la vez.
  setTimeout(correrRapido, 120_000);
  setInterval(correrRapido, RAPIDO_MS);
  console.log(
    `[factura] cotejo contra Ventra cada ${(CADA_MS / 60000).toFixed(0)} min · ` +
      `carril rápido de hoy cada ${(RAPIDO_MS / 1000).toFixed(0)} s`,
  );
}
