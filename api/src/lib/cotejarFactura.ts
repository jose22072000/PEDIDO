/**
 * Cotejar un PEDIDO con su FACTURA.
 *
 * Esto vivía en delivery, que es quien primero necesitó saberlo para cargar el camión.
 * Vive aquí porque el pedido es de PEDIDO: es aquí donde hay que poder decir si un
 * pedido llegó a facturarse, y es aquí donde se corrige cuando la factura dice otra cosa.
 * Teniéndolo en los dos sitios habría dos cotejos con dos criterios que un día discrepan,
 * y el que discrepa es el que se despacha.
 *
 * El cliente cambia lo que pidió antes de que se le facture: pide veinte cajas y se lleva
 * quince. La ruta hay que armarla con lo FACTURADO, porque es lo que va en el camión y lo
 * que se cobra; repartir por el pedido viejo es cargar de más y descuadrar la caja.
 *
 * Aquí no se decide nada de negocio: se compara y se dice en qué estado quedó.
 *
 *   igual        — lo facturado coincide con lo pedido. Se puede repartir tal cual.
 *   cambiado     — se facturó otra cosa: más, menos o distinto.
 *   sin_factura  — ese pedido todavía no aparece en la facturación de ese día.
 *
 * # De quién es cada factura NO se decide aquí
 *
 * Se decidía, por nombre de cliente, y estaba mal: un cliente pide el lunes y el martes, y
 * las facturas de los dos días caben en los dos pedidos. En producción acabó la misma
 * factura pegada a dos pedidos distintos, uno completado y otro en proceso.
 *
 * Ahora lo decide `emparejarFactura` con el FOLIO que la factura lleva escrito en su nota,
 * que es el único dato que ata una factura a un pedido concreto. Aquí llegan ya sólo las
 * facturas de ESTE pedido, y lo único que se hace es comparar las líneas.
 */

/** Una línea del pedido, tal como está en `PedidoItem`. */
import { esServicio, esEntregaADomicilio } from './servicios'

export interface LineaPedido {
  producto?: string | null
  descripcion?: string | null
  /** El código de Ventra, si el pedido lo trae. Es la forma EXACTA de emparejar. */
  codigo?: string | null
  packs?: number | null
  unidades?: number | null
}

export interface LineaFactura {
  operNumber: string
  clienteNombre: string
  /** El código de Ventra. Es el mismo `sku` del catálogo: sirve para pesar la factura. */
  productoCodigo?: string | null
  productoNombre: string
  cantidad: number
  /** Lo que se cobró por esa línea. Sólo se usa para la del domicilio. */
  precioUsd?: number | null
}

export type EstadoFactura = 'igual' | 'cambiado' | 'sin_factura'

/** Una línea de la factura con lo mismo que se enseña de una línea del pedido. */
/**
 * Cómo quedó una línea de la factura al compararla con el pedido.
 *
 *   igual   se pidió y se facturó lo mismo
 *   cambio  se pidió, pero se facturó otra cantidad
 *   nuevo   se facturó sin haberse pedido
 *
 * Va DENTRO de la línea y no en un texto aparte porque es lo que la pantalla pinta al
 * lado de cada producto. Deducirlo otra vez en el front sería repetir allí el
 * emparejador —el que sabe que «PARRANDA 1.5L» y «CERVEZA PARRANDA 1500 ML BLISTER 6U»
 * son lo mismo— en un sitio donde no está, no se puede probar y se iría separando de
 * éste sin que nadie lo note.
 */
export type MarcaLinea = 'igual' | 'cambio' | 'nuevo'

/** Lo que se pidió y la factura no trae. */
export interface Faltante {
  producto: string
  /** Formatos que se pidieron. */
  pedido: number
}

export interface LineaCotejada {
  producto: string
  codigo: string | null
  /** Formatos: las unidades de venta, que es como se factura y como se carga el camión. */
  cantidad: number
  /** Unidades sueltas. Nulo cuando no hay de dónde deducir cuántas trae el formato. */
  unidades: number | null
  /** Kilos de la línea entera. Nulo cuando el producto no está en el catálogo. */
  pesoKg: number | null
  /** Lo que se cobró por esa línea. */
  importe: number | null
  /** Cómo quedó frente al pedido. Ver `MarcaLinea`. */
  marca: MarcaLinea
  /** Cuántos formatos se pidieron de ese producto. Nulo cuando no se pidió. */
  pedido: number | null
}

export interface Cotejo {
  estado: EstadoFactura
  numero: string | null
  /**
   * Lo que la factura dice, por producto, con lo mismo que se enseña del pedido:
   * formatos, unidades, kilos e importe. Sin eso hay que mirar dos pantallas para
   * comparar dos listas que están una encima de la otra.
   *
   * `unidades` y `pesoKg` van en nulo cuando no se pueden saber —un producto que no
   * estaba en el pedido no tiene de dónde sacar cuántas unidades trae el formato, y uno
   * que no está en el catálogo no tiene peso—. Nulo se pinta como «—»; un cero se lee
   * como que no pesa.
   */
  lineas: LineaCotejada[]
  /** En qué se diferencian, en palabras. Vacío cuando cuadra. */
  diferencias: string[]
  /**
   * Lo que se pidió y NO aparece en la factura.
   *
   * Va aparte y no como una línea más de `lineas` porque esa lista es la que reescribe
   * el pedido cuando se corrige: un producto con cero formatos ahí acabaría subiendo al
   * camión como un artículo de cero. Aquí no estorba y la pantalla lo pinta al final,
   * que es donde hace falta — un producto que desapareció es justo lo que hay que ver.
   */
  faltantes: Faltante[]
  /**
   * Lo que la factura cobró por el DOMICILIO, si trae esa línea.
   *
   * Es la señal más fiable de que ese pedido va a domicilio: sale de lo que se cobró, no
   * de una casilla que alguien marcó al tomar el pedido. Null cuando la factura no la
   * lleva — que significa que ese pedido se recogió en el almacén.
   */
  domicilioFacturado: number | null
}

/** Sin tildes, sin signos, en minúsculas: para poder comparar nombres escritos a mano. */
export function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Las palabras con las que se reconoce un producto entre los dos sistemas.
 *
 * Ventra lo llama «CERVEZA PARRANDA 1500 ML BLISTER 6U» y el pedido «PARRANDA 1.5L». No
 * hay forma de que coincidan enteros, así que se comparan por las palabras que sí
 * comparten: la marca y el número del formato.
 */
export function clavesDeProducto(nombre: string): Set<string> {
  /**
   * El formato, a mililitros, ANTES de normalizar.
   *
   * Normalizar quita el punto —«1.5L» se queda en «1 5l»— y entonces ya no hay forma de
   * saber que son mil quinientos. Se convierte primero y se normaliza después.
   */
  const enMl = (nombre || '')
    .toLowerCase()
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, a, b) => ` ${Number(`${a}.${b}`) * 1000} `)
    .replace(/(\d+)\s*ml\b/g, ' $1 ')
    .replace(/(\d+)\s*l\b/g, (_, a) => ` ${Number(a) * 1000} `)

  return new Set(normalizar(enMl).split(' ').filter((p) => p.length > 2))
}

/**
 * Cuántas unidades trae un formato, leído del NOMBRE del producto.
 *
 * Casi siempre lo dice: «CAJA 24U», «BLISTER 6U», «PACA 10U». Y a veces en dos pisos —
 * «PACA 12P DE 4U» son doce paquetes de cuatro, o sea cuarenta y ocho.
 *
 * Hace falta para los productos que la factura trae y el pedido no: de ésos no hay
 * ninguna línea de la que copiar la proporción, y sin esto salían con las unidades en
 * blanco. El dato estaba escrito ahí delante todo el tiempo.
 *
 * Devuelve `null` cuando el nombre no lo dice. Suponer «1» sería inventarse una cifra que
 * después alguien suma.
 */
export function unidadesPorFormato(nombre: string): number | null {
  const n = (nombre || '').toUpperCase()

  // Dos pisos primero: «12P DE 4U» son 48, no 4. Mirando sólo la «U» final saldría 4.
  const dosPisos = /(\d+)\s*P\s+DE\s+(\d+)\s*U\b/.exec(n)

  if (dosPisos) return Number(dosPisos[1]) * Number(dosPisos[2])

  // Y el corriente: «CAJA 24U», «BLISTER 6U», «PACA 10U».
  const simple = /(\d+)\s*U\b/.exec(n)

  if (simple) {
    const v = Number(simple[1])

    return v > 0 ? v : null
  }

  return null
}

/** Cuántas palabras comparten dos nombres de producto. */
export function parecido(a: string, b: string): number {
  const ca = clavesDeProducto(a)
  const cb = clavesDeProducto(b)

  return [...ca].filter((p) => cb.has(p)).length
}

/** ¿Son el mismo producto? Comparten marca y formato. */
export function mismoProducto(a: string, b: string): boolean {
  // Al menos dos coincidencias: con una sola, «PARRANDA» casaría con cualquier parranda
  // de cualquier formato y el cotejo diría que cuadra cuando no.
  return parecido(a, b) >= 2
}

/**
 * Cuál de las líneas facturadas es ESTA línea del pedido.
 *
 * # El fallo que esto corrige
 *
 * Antes se cogía la PRIMERA que compartiera dos palabras, y con eso el orden de la
 * factura decidía el resultado. Un pedido de tres refrescos:
 *
 *     REFRESCO SANTA ORANGE 330 ML CAJA 24U
 *     REFRESCO SANTA COLA   330 ML CAJA 24U
 *     REFRESCO SANTA PINA   330 ML CAJA 24U
 *
 * comparte CINCO palabras entre los tres —refresco, santa, 330, caja, 24u— y sólo se
 * diferencia en el sabor. Así que ORANGE casaba con PIÑA, PIÑA con ORANGE, y un pedido
 * idéntico a su factura salía «cambiado» con dos diferencias inventadas.
 *
 * No es cosa de los refrescos: pasa con `ARROZ RIVIERA 1 KG PACA 10U` contra
 * `ARROZ PATEKO 1 KG PACA 10U`, y con el mismo aceite en dos tamaños. Es justo lo que
 * distingue un producto de otro —la marca, el sabor, el formato— lo que se ignoraba.
 *
 * # Cómo se elige ahora
 *
 * 1. **Por código**, si los dos lo traen. Es exacto y no hay nada que interpretar.
 * 2. Si no, la que MÁS palabras comparta, y sólo si gana sola. Dos empatadas en lo alto
 *    quieren decir que no se puede distinguir: se deja sin emparejar y sale como
 *    diferencia, que se ve. Elegir una de las dos a cara o cruz es lo que hacía antes.
 */
// Genérica para que la elegida salga con el MISMO tipo que entró. Con una firma que
// devolviera sólo `{producto, codigo, cantidad}` no se podría marcar la línea que
// eligió —que es a lo que se llama esto— sin volver a buscarla en la lista.
export function elegirLinea<T extends { producto: string; codigo: string | null; cantidad: number }>(
  pedido: LineaPedido,
  candidatas: T[],
): T | null {
  if (candidatas.length === 0) return null

  const codigo = (pedido.codigo || '').trim().toUpperCase()

  if (codigo) {
    const exacta = candidatas.find((c) => (c.codigo || '').trim().toUpperCase() === codigo)

    if (exacta) return exacta
  }

  const nombre = (pedido.producto || pedido.descripcion || '').trim()

  if (!nombre) return null

  const puntuadas = candidatas
    .map((c) => ({ c, puntos: parecido(nombre, c.producto) }))
    .filter((x) => x.puntos >= 2)
    .sort((a, b) => b.puntos - a.puntos)

  if (puntuadas.length === 0) return null
  // Si dos empatan arriba, no se puede saber cuál es: mejor decirlo que acertar a medias.
  if (puntuadas.length > 1 && puntuadas[1].puntos === puntuadas[0].puntos) return null

  return puntuadas[0].c
}

/**
 * @param lineasPedido  lo que se pidió (`items` del pedido).
 * @param facturas      TODAS las líneas facturadas de esa sucursal ese día.
 * @param cliente       el nombre del cliente del pedido.
 */
export function cotejar(lineasPedido: LineaPedido[], suyas: LineaFactura[]): Cotejo {
  if (suyas.length === 0) {
    return { estado: 'sin_factura', numero: null, lineas: [], diferencias: [], faltantes: [], domicilioFacturado: null }
  }

  /**
   * El COBRO DEL REPARTO no es mercancía: se aparta antes de comparar.
   *
   * Ventra lo factura como una línea más, «ENTREGA A DOMICILIO», con categoría de
   * servicio y peso cero. Dejándola dentro, TODOS los pedidos a domicilio salían
   * «cambiados» —esa línea nunca está en el pedido— y encima se copiaba al pedido como si
   * fuera algo que hay que subir al camión.
   *
   * Lo que sí se guarda es cuánto cobró: es lo que de verdad pagó el cliente por el
   * reparto, y es la señal de que ese pedido va a domicilio.
   */
  const mercancia = suyas.filter((f) => !esServicio({ nombre: f.productoNombre }))
  const domicilio = suyas.filter((f) => esEntregaADomicilio({ nombre: f.productoNombre }))
  const domicilioFacturado = domicilio.length
    ? Number(domicilio.reduce((t, f) => t + (Number(f.precioUsd) || 0) * (Number(f.cantidad) || 1), 0).toFixed(2))
    : null

  /**
   * Si tiene varias facturas ese día, se cotejan TODAS juntas.
   *
   * Pasa cuando el pedido se factura en dos documentos. Compararlo contra una sola diría
   * «cambiado» siempre, y la mitad de los pedidos se quedarían fuera de la ruta.
   */
  const numero = [...new Set(suyas.map((f) => f.operNumber))].sort().join(', ')
  const facturado = new Map<string, { codigo: string | null; cantidad: number; importe: number | null }>()

  for (const f of mercancia) {
    const previo = facturado.get(f.productoNombre)
    // Lo que se cobró por la línea. Si Ventra no manda precio se queda en nulo y se
    // pinta como «—»: un cero ahí se lee como que ese producto salió gratis.
    const precio = Number(f.precioUsd)
    const suma = Number.isFinite(precio) ? precio * f.cantidad : null

    facturado.set(f.productoNombre, {
      // El código se guarda para poder pesar la factura por sku, que es exacto; el
      // nombre queda para lo que Ventra no codifica.
      codigo: previo?.codigo ?? f.productoCodigo ?? null,
      cantidad: (previo?.cantidad ?? 0) + f.cantidad,
      importe: suma == null ? (previo?.importe ?? null) : (previo?.importe ?? 0) + suma,
    })
  }

  const lineas: LineaCotejada[] = [...facturado.entries()].map(([producto, v]) => ({
    producto,
    codigo: v.codigo,
    cantidad: v.cantidad,
    // Se rellenan fuera, con el pedido y el catálogo delante. Ver `enriquecerLineas`.
    unidades: null,
    pesoKg: null,
    importe: v.importe == null ? null : Number(v.importe.toFixed(2)),
    // Todas empiezan como «no se pidió»; el bucle de abajo va bajando esa marca a
    // medida que cada línea encuentra su producto en el pedido. Lo que quede sin tocar
    // es, literalmente, lo que la factura trae de más.
    marca: 'nuevo' as MarcaLinea,
    pedido: null as number | null,
  }))
  const diferencias: string[] = []
  const faltantes: Faltante[] = []
  const usadas = new Set<string>()

  for (const l of lineasPedido) {
    const nombre = (l.producto || l.descripcion || '').trim()

    if (!nombre) continue
    // Lo pedido va en unidades de VENTA (los packs), igual que la cantidad de Ventra.
    const pedidas = Number(l.packs) > 0 ? Number(l.packs) : Number(l.unidades) || 0
    const encaje = elegirLinea(l, lineas.filter((f) => !usadas.has(f.producto)))

    if (!encaje) {
      diferencias.push(`${nombre}: pedido ${pedidas}, no facturado`)
      faltantes.push({ producto: nombre, pedido: pedidas })
      continue
    }
    usadas.add(encaje.producto)
    encaje.pedido = pedidas
    if (Math.abs(encaje.cantidad - pedidas) > 0.001) {
      encaje.marca = 'cambio'
      diferencias.push(`${nombre}: pedido ${pedidas}, facturado ${encaje.cantidad}`)
    } else {
      encaje.marca = 'igual'
    }
  }

  // Y lo que se facturó sin haberse pedido: también es una diferencia.
  for (const f of lineas) {
    if (!usadas.has(f.producto)) diferencias.push(`${f.producto}: facturado ${f.cantidad}, no pedido`)
  }

  return {
    estado: diferencias.length === 0 ? 'igual' : 'cambiado',
    numero,
    lineas,
    diferencias,
    faltantes,
    domicilioFacturado,
  }
}
