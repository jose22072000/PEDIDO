import {
  Card,
  CardBody,
  Chip,
  Snippet,
  Pagination,
  Button,
  Input,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  useDisclosure,
  Divider,
  Autocomplete,
  AutocompleteItem,
  Select,
  Accordion,
  AccordionItem,
  CheckboxGroup,
  Checkbox,
  SelectItem,
  addToast,
  Tooltip,
  Switch,
  Tab,
  Tabs,
} from "@heroui/react";
import { useEffect, useState, useCallback, useRef } from "react";
import type { ElementType } from "react";

import { usePantallaChica } from "../../hooks/pantalla";

import { cards } from "../primitives";
import Icons from "../icons/iconify";
import { VendedorSelect } from "../vendedor-select";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { registrarCopia } from "@/lib/registrar-copia";
import { esFechaEnviable } from "@/lib/fecha-enviable";
import { getApiBaseUrl } from "@/config";
import {
  importe,
  importeCrudo,
  monedaGuardada,
  guardarMoneda,
  type Moneda,
} from "@/lib/moneda";
import { useAuthStore } from "@/stores/authStore";
import { useLiveStatus, useLiveEvents } from "@/hooks/use-live-events";
import { aplicarLote } from "@/hooks/aplicar-eventos";
import { getSucursalActiva } from "@/components/sucursal-selector";
import {
  usarPedidos,
  type Order,
  type RespuestaPedidos,
} from "@/stores/datos/pedidos";
import { useCerrarAlPulsarFuera } from "@/hooks/cerrar-al-pulsar-fuera";
import { mensajeDeError } from "@/lib/error-del-servidor";

// Los tipos del listado viven en el store: los comparten quien los pinta y quien
// los trae, y asi no se separan cuando cambie el api.

const estadoColors: Record<string, "success" | "warning" | "danger"> = {
  completada: "success",
  en_proceso: "warning",
  expirada: "danger",
};

const estadoLabels: Record<string, string> = {
  todos: "Todos",
  completada: "Completado",
  en_proceso: "En Proceso",
  expirada: "Expirado",
};

/**
 * Cómo se enseña el cotejo contra la FACTURA de Ventra.
 *
 * `cambiado` es el que importa: el cliente se llevó otra cosa de lo que pidió, así que
 * lo que dice el pedido ya no es lo que se cobró ni lo que sale en el camión. Va en
 * ámbar y no en rojo porque no es un error de nadie —pasa todos los días—, pero tiene
 * que verse sin abrir el pedido.
 */
/**
 * Un pedido que cambió SIGUE ESTANDO FACTURADO.
 *
 * Salía en ámbar, con la misma pinta que una alarma, y eso se lee como «algo va mal con
 * esta factura». No va mal: se facturó, y además cambió. Son dos cosas y antes se decían
 * como una. Ahora las dos van en verde —están facturadas— y lo que cambió lo dice el
 * texto, no el color.
 */
const facturaChip: Record<string, { color: "success" | "warning" | "default"; texto: string }> = {
  igual: { color: "success", texto: "Facturado" },
  cambiado: { color: "success", texto: "Facturado · cambió" },
  sin_factura: { color: "default", texto: "Sin facturar" },
};

/**
 * Un pedido que CUADRA porque se corrigió no es lo mismo que uno que vino bien.
 *
 * Los dos quedan en `igual` —cuadran con la factura, y por eso se pueden repartir— pero
 * uno se tomó bien y el otro se reescribió con lo facturado. Quien mira el pedido tiene
 * que poder ver cuál es cuál: si no, el vendedor abre el suyo, ve otras cantidades de las
 * que tomó, y lo único que puede pensar es que alguien se las cambió a escondidas.
 */
const chipDeFactura = (
  order: { facturaEstado?: string | null; facturaCorregidoAt?: string | null },
): { color: "success" | "warning" | "default"; texto: string } | null => {
  if (order.facturaCorregidoAt) {
    return { color: "success", texto: "Facturado · corregido" };
  }
  return order.facturaEstado ? facturaChip[order.facturaEstado] ?? null : null;
};

/**
 * Las líneas de la factura, que se guardan en TEXTO.
 *
 * En JSON y no en una tabla aparte porque es una foto: no se consulta, no se filtra y no
 * se vuelve a tocar — sólo se enseña al lado del pedido. Y si algún día llegara mal
 * escrito, se devuelve una lista vacía en vez de tumbar la pantalla del pedido entero.
 */
interface LineaFacturada {
  producto: string;
  codigo: string | null;
  /** Formatos: las unidades de venta, que es como se factura y se carga el camión. */
  cantidad: number;
  /** Nulos cuando no se pueden saber. Se pintan «—»; un cero seria mentira. */
  unidades: number | null;
  pesoKg: number | null;
  importe: number | null;
  /**
   * Cómo quedó esa línea frente al pedido. La pone el cotejo, en la API, que es donde
   * está el emparejador que sabe que «PARRANDA 1.5L» y «CERVEZA PARRANDA 1500 ML
   * BLISTER 6U» son el mismo producto. Aquí sólo se pinta.
   *
   * `falta` no es una línea de la factura: es algo que se pidió y la factura no trae.
   * Viaja en la misma lista para poder enseñarlo al final, donde se ve.
   *
   * Opcional porque las filas guardadas antes de esto no la traen; sin marca se pintan
   * neutras, que es lo que eran.
   */
  marca?: "igual" | "cambio" | "nuevo" | "falta";
  /** Formatos que se pidieron de ese producto. Nulo cuando no se pidió. */
  pedido?: number | null;
}

/** Cómo se pinta cada línea según cómo quedó. */
const estiloLinea: Record<string, { caja: string; texto: string }> = {
  igual: { caja: "border-default-200 bg-default-50", texto: "text-default-500" },
  cambio: { caja: "border-warning-400 bg-warning-50", texto: "text-warning-700" },
  nuevo: { caja: "border-primary-400 bg-primary-50", texto: "text-primary-700" },
  falta: { caja: "border-danger-400 bg-danger-50", texto: "text-danger-600" },
};

/**
 * Lo que se le dice al que mira, en palabras, de una línea que no cuadra.
 *
 * Con las cantidades de LOS DOS LADOS. «2 formatos» a secas no dice nada: lo que hace
 * falta saber es que se pidieron seis.
 */
function notaDeLinea(l: LineaFacturada): string | null {
  const pedidos = l.pedido ?? 0;

  if (l.marca === "cambio")
    return `se ${pedidos === 1 ? "pidió" : "pidieron"} ${pedidos}, se ${l.cantidad === 1 ? "facturó" : "facturaron"} ${l.cantidad}`;
  if (l.marca === "nuevo") return "no estaba en el pedido";
  if (l.marca === "falta")
    return `se ${pedidos === 1 ? "pidió" : "pidieron"} ${pedidos}, no se facturó`;

  return null;
}

/**
 * El total de la factura, para poder compararlo con el del pedido sin sumar a mano.
 *
 * Las líneas `falta` se dejan fuera de las sumas: no están en la factura, y meterlas
 * daría un peso y un importe que ese papel no dice en ninguna parte.
 */
function resumenFactura(ls: LineaFacturada[]) {
  const reales = ls.filter((l) => l.marca !== "falta");

  return {
    lineas: reales.length,
    formatos: reales.reduce((t, l) => t + (l.cantidad || 0), 0),
    unidades: reales.reduce((t, l) => t + (l.unidades ?? 0), 0),
    kg: Number(reales.reduce((t, l) => t + (l.pesoKg ?? 0), 0).toFixed(2)),
    importe: reales.reduce((t, l) => t + (l.importe ?? 0), 0),
    /**
     * CUÁNTAS líneas traen de verdad cada cifra.
     *
     * Las facturas cotejadas antes de que se guardaran importes y pesos tienen las
     * líneas a medias —producto, código y formatos, nada más—, y sumarlas daba «$0.00»
     * y «0 kg» en el total. Eso no es un dato que falta: es una factura diciendo que no
     * vale nada, que es peor que no decir nada. Con esto, el que pinta sabe cuándo tiene
     * que callarse y poner un guion.
     */
    conImporte: reales.filter((l) => l.importe != null).length,
    conPeso: reales.filter((l) => l.pesoKg != null).length,
    conUnidades: reales.filter((l) => l.unidades != null).length,
  };
}

function lineasDeFactura(json: string): LineaFacturada[] {
  try {
    const v = JSON.parse(json);

    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * En qué punto del REPARTO va el pedido. Lo pone delivery, y es OTRA COSA que el estado.
 *
 * Un pedido tiene tres estados a la vez y ninguno manda sobre los otros: el suyo —en
 * proceso, completado, expirado, que lo mueve el vendedor—, el del reparto que es éste, y
 * el de la factura. Entregar un pedido NO lo completa, y facturarlo tampoco: completar es
 * del vendedor. Meterlos en el mismo campo rompe el archivado, el expirado y los filtros
 * de la lista a la vez.
 *
 * Los nombres son los cuatro que se usan en delivery. Los de la izquierda son los valores
 * que se guardan, que no se tocan: hay meses de pedidos escritos con ellos.
 *
 * `devuelto` y `cancelado` no son un punto del reparto sino cómo ACABÓ, y van en rojo
 * porque son los que hay que mirar: mercancía que volvió al almacén y dinero que no entró.
 */
const entregaChip: Record<string, { color: "success" | "warning" | "primary" | "danger"; texto: string }> = {
  despachado: { color: "primary", texto: "En despacho" },
  en_transito: { color: "warning", texto: "En ruta" },
  entregado: { color: "success", texto: "Entregado" },
  devuelto: { color: "danger", texto: "Devuelto" },
  cancelado: { color: "danger", texto: "Cancelado" },
};

/**
 * Sin tildes y en minúscula, para buscar.
 *
 * «facturacion» tiene que encontrar «Facturación»: quien teclea deprisa en el buscador
 * de un desplegable no pone las tildes, y si no sale nada da por hecho que ese filtro
 * no existe.
 */
const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Los otros dos estados por los que se filtra.
 *
 * Se arman desde los mismos diccionarios que pintan los chips, para que la opción del
 * filtro y la etiqueta de la tarjeta no puedan decir cosas distintas. Delante va el
 * hueco —lo que todavía no ha pasado—, que es lo que más se busca: qué falta por
 * repartir y qué falta por cotejar.
 */
const repartoOptions = [
  { value: "todos", label: "Todo el reparto" },
  { value: "sin_reparto", label: "Sin repartir" },
  ...Object.entries(entregaChip).map(([value, v]) => ({ value, label: v.texto })),
];

const facturaOptions = [
  { value: "todos", label: "Toda la facturación" },
  { value: "sin_cotejar", label: "Sin cotejar" },
  ...Object.entries(facturaChip).map(([value, v]) => ({ value, label: v.texto })),
];

const estadoOptions = [
  { value: "todos", label: "Todos" },
  { value: "en_proceso", label: "En Proceso" },
  { value: "completada", label: "Completado" },
  { value: "expirada", label: "Expirado" },
];

const domicilioOptions = [
  { value: "todos", label: "Todos" },
  { value: "calculado", label: "Con domicilio (con precio)" },
  { value: "pendiente", label: "Domicilio sin calcular" },
  { value: "requiere", label: "Requieren domicilio" },
  { value: "sin", label: "Sin domicilio" },
];

interface VendedorOpt {
  id: string;
  nombre: string;
  codigo?: string | null;
}

/** Cuantos pedidos por pagina. Fijo, asi que no hace falta llevarlo en estado. */
const POR_PAGINA = 10;

// Referencias FIJAS para cuando aun no hay datos: en linea serian objetos nuevos
// en cada render y dispararian efectos y memos sin parar.
const SIN_PEDIDOS: Order[] = [];
const PAGINACION_VACIA = {
  page: 1,
  limit: POR_PAGINA,
  total: 0,
  totalPages: 1,
};

interface FiltrosPedidos {
  page: number;
  /**
   * Los TRES estados de un pedido, cada uno con los valores marcados.
   *
   * Listas y no una cadena: la pantalla los agrupa en un desplegable con casillas —como
   * los filtros de una hoja de cálculo— porque la barra no daba para uno por cada uno, y
   * con casillas se marcan varios. Vacía es «no filtres por esto».
   */
  estados: string[];
  repartos: string[];
  facturas: string[];
  search: string;
  fechaDesde: string;
  fechaHasta: string;
  domicilio: string;
  vendedor: string;
  producto: string;
  incluirArchivados: boolean;
}

/** La clave de cache: TIENE que llevar todo lo que cambia el resultado. */
const clavePedidos = (f: FiltrosPedidos, sucursal: string) =>
  [
    "pedidos",
    sucursal,
    f.page,
    // Ordenados: marcar A y luego B tiene que dar la MISMA clave que marcar B y luego
    // A, o la misma consulta se pide dos veces y se guarda dos veces.
    [...f.estados].sort().join(","),
    [...f.repartos].sort().join(","),
    [...f.facturas].sort().join(","),
    f.search,
    f.fechaDesde,
    f.fechaHasta,
    f.domicilio,
    f.vendedor,
    f.producto,
    f.incluirArchivados ? "1" : "0",
  ].join(":");

const traerPedidos =
  (f: FiltrosPedidos) =>
  async (signal: AbortSignal): Promise<RespuestaPedidos> => {
    const params = new URLSearchParams({
      page: String(f.page),
      limit: String(POR_PAGINA),
    });

    if (f.estados.length > 0) params.append("estado", f.estados.join(","));
    if (f.repartos.length > 0) params.append("reparto", f.repartos.join(","));
    if (f.facturas.length > 0) params.append("factura", f.facturas.join(","));
    if (f.search.length > 0) params.append("search", f.search);
    // Solo si estan COMPLETAS: una fecha a medio teclear tumbaba la consulta.
    if (esFechaEnviable(f.fechaDesde)) params.append("fechaDesde", f.fechaDesde);
    if (esFechaEnviable(f.fechaHasta)) params.append("fechaHasta", f.fechaHasta);
    if (f.domicilio !== "todos") params.append("domicilio", f.domicilio);
    if (f.vendedor !== "todos") params.append("vendedorId", f.vendedor);
    if (f.producto) params.append("producto", f.producto);
    // Switch: si esta activo, la busqueda incluye tambien los archivados (se
    // distinguen en la tarjeta con el chip "Archivado"). Si no, solo activos.
    if (f.incluirArchivados) params.append("incluirArchivados", "1");

    const r = await fetch(`${getApiBaseUrl()}/orders?${params}`, { signal });

    if (!r.ok) throw new Error("Error al cargar los pedidos");

    return r.json();
  };

/**
 * Parte el nombre de un producto en categoría y lo demás.
 *
 * Vienen como "ALIMENTOS ACEITE SOYA 1L" o "CERVEZA CERVEZA SANTIAGO": la categoría
 * va DELANTE, y en un desplegable estrecho se come el ancho y los recorta a todos por
 * el mismo sitio — "ALIMENTOS ARROZ ENER...", "ALIMENTOS ARROZ PATE..."—, así que se
 * ven iguales y no se distingue cuál es cuál, que es justo lo que hay que elegir.
 *
 * Separándolos, el nombre de verdad va primero y la categoría queda debajo en pequeño.
 * Si la categoría se repite ("CERVEZA CERVEZA SANTIAGO") se quita la repetida: es
 * ruido que ya está dicho.
 */
function partirProducto(nombre: string): { categoria: string; producto: string } {
  const partes = nombre.trim().split(/\s+/);
  if (partes.length < 2) return { categoria: "", producto: nombre };

  const categoria = partes[0];
  const resto = partes.slice(1);
  if (resto[0] === categoria) resto.shift();

  return { categoria, producto: resto.join(" ") || nombre };
}

/** Un día, escrito para leerlo: "12 de agosto de 2026". */
function comoSeLeeElDia(valor?: string | null): string | null {
  if (!valor) return null;
  return new Date(valor).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Un instante, con hora. Para "cuándo entró esto en el sistema" el día solo no
 *  sirve —dos pedidos del mismo día no se distinguen— y la hora es justo lo que se
 *  mira cuando alguien pregunta si un pedido llegó antes o después de otro. */
function comoSeLeeElInstante(valor?: string | null): string | null {
  if (!valor) return null;
  return new Date(valor).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const OrdersList = () => {
  const [page, setPage] = useState(1);
  const [estadosSel, setEstadosSel] = useState<string[]>([]);
  const [repartosSel, setRepartosSel] = useState<string[]>([]);
  const [facturasSel, setFacturasSel] = useState<string[]>([]);
  const [buscaFiltro, setBuscaFiltro] = useState("");

  /**
   * LO MARCADO Y LO APLICADO SON DOS COSAS.
   *
   * En el cajón se van marcando casillas —y son varias combinaciones: pedido, reparto y
   * factura a la vez— pero la lista no se mueve hasta que se le da a Aplicar. Cambiando
   * en el momento, cada casilla lanzaría una consulta y la lista bailaría debajo
   * mientras alguien todavía está decidiendo qué quiere ver.
   *
   * `estadosSel` y compañía son lo aplicado, lo que va a la consulta. `borr…` es lo que
   * hay marcado en el cajón ahora mismo.
   */
  const {
    isOpen: filtrosAbiertos,
    onOpen: abrirFiltros,
    onClose: cerrarFiltros,
  } = useDisclosure();
  const [borrEstados, setBorrEstados] = useState<string[]>([]);
  const [borrRepartos, setBorrRepartos] = useState<string[]>([]);
  const [borrFacturas, setBorrFacturas] = useState<string[]>([]);
  const [borrProducto, setBorrProducto] = useState("");
  const [borrDomicilio, setBorrDomicilio] = useState("todos");
  const [borrVendedor, setBorrVendedor] = useState("todos");
  const [borrArchivados, setBorrArchivados] = useState(false);
  const borrMarcados =
    borrEstados.length +
    borrRepartos.length +
    borrFacturas.length +
    (borrProducto ? 1 : 0) +
    (borrDomicilio !== "todos" ? 1 : 0) +
    (borrVendedor !== "todos" ? 1 : 0) +
    (borrArchivados ? 1 : 0);

  // Al abrir, el borrador parte de lo que ya está puesto: si no, abrir el cajón para
  // añadir un estado más borraría los que ya estaban.
  const abrirCajonDeFiltros = () => {
    setBorrEstados(estadosSel);
    setBorrRepartos(repartosSel);
    setBorrFacturas(facturasSel);
    setBorrProducto(productoFilter);
    setBorrDomicilio(domicilioFilter);
    setBorrVendedor(vendedorFilter);
    setBorrArchivados(incluirArchivados);
    setBuscaFiltro("");
    abrirFiltros();
  };

  const aplicarFiltros = () => {
    setEstadosSel(borrEstados);
    setRepartosSel(borrRepartos);
    setFacturasSel(borrFacturas);
    setProductoFilter(borrProducto);
    setDomicilioFilter(borrDomicilio);
    setVendedorFilter(borrVendedor);
    setIncluirArchivados(borrArchivados);
    setPage(1); // otra búsqueda es otra lista: volver a la primera página
    cerrarFiltros();
  };

  /**
   * Los tres grupos del desplegable de estados, en una lista.
   *
   * Escritos uno a uno eran el mismo bloque copiado tres veces: el que añada un cuarto
   * estado —o el buscador, o un «marcar todos»— tiene que acordarse de tocarlo en los
   * tres, y siempre se olvida uno.
   */
  const gruposDeEstado = [
    { titulo: "Pedido", opciones: estadoOptions, valor: borrEstados, poner: setBorrEstados },
    { titulo: "Reparto", opciones: repartoOptions, valor: borrRepartos, poner: setBorrRepartos },
    { titulo: "Facturación", opciones: facturaOptions, valor: borrFacturas, poner: setBorrFacturas },
  ].map((g) => ({
    ...g,
    // «Todos» es la ausencia de filtro, no una opción que marcar.
    // Y lo que no case con la búsqueda se cae, salvo que esté MARCADO: esconder algo
    // que está filtrando la lista es cómo alguien mira una lista corta sin entender
    // por qué.
    opciones: g.opciones.filter(
      (o) =>
        o.value !== "todos" &&
        (g.valor.includes(o.value) ||
          normalizar(o.label).includes(normalizar(buscaFiltro))),
    ),
  }));
  const [domicilioFilter, setDomicilioFilter] = useState<string>("todos");
  const [vendedorFilter, setVendedorFilter] = useState<string>("todos");
  const [vendedores, setVendedores] = useState<VendedorOpt[]>([]);
  // Incluir archivados en la búsqueda actual (el usuario elige). No aplica cuando el
  // estado ya es "archivados" (ahí se ven solo archivados).
  const [incluirArchivados, setIncluirArchivados] = useState(false);
  // Los productos que existen en esta sucursal, para el selector del filtro. Se piden
  // una vez: cambian cuando entran pedidos nuevos, no mientras se mira la lista.
  const [orderToReabrir, setOrderToReabrir] = useState<Order | null>(null);
  const [productos, setProductos] = useState<string[]>([]);
  const [productoFilter, setProductoFilter] = useState<string>("");

  /**
   * Cuántos filtros hay puestos, contando los siete.
   *
   * Es lo único que, con el cajón cerrado, dice que la lista está recortada. Contando
   * sólo los estados, alguien que dejó puesto un vendedor mira una lista corta creyendo
   * que están todos.
   */
  const marcados =
    estadosSel.length +
    repartosSel.length +
    facturasSel.length +
    (productoFilter ? 1 : 0) +
    (domicilioFilter !== "todos" ? 1 : 0) +
    (vendedorFilter !== "todos" ? 1 : 0) +
    (incluirArchivados ? 1 : 0);
  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");

  useEffect(() => {
    let vivo = true;
    fetch(`${getApiBaseUrl()}/orders/productos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((lista) => {
        if (vivo) setProductos(Array.isArray(lista) ? lista : []);
      })
      .catch(() => {
        // Sin lista, el selector sale vacío y el resto de la pantalla sigue
        // funcionando: un filtro que no se puede llenar no puede tumbar la lista.
      });
    return () => {
      vivo = false;
    };
  }, []);
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchValue, setSearchValue] = useState<string>("");
  // La moneda en la que se enseñan los importes. Es preferencia de quien mira, no del

  // pedido: quien factura quiere CUP y quien mira márgenes, USD.

  const [moneda, setMoneda] = useState<Moneda>("USD");

  const [tasa, setTasa] = useState<number | null>(null);

  const [tasaVieja, setTasaVieja] = useState<string | null>(null);

  

  /**
   * La tasa, y quién avisa cuando cambia.
   *
   * Se pedía una sola vez al cargar la pantalla, y como el worker sólo la refresca cada
   * 12 h, el selector CUP se quedaba en gris diciendo "todavía no hay tasa" mucho después
   * de que ya la hubiera. Había que recargar a mano para verla.
   */
  const traerTasa = useCallback(() => {
    // Con la sucursal que se está viendo: cada una tiene su tasa, y usar la de otra da
    // un importe en CUP creíble y equivocado. Va el ID, que es lo que guarda el selector;
    // la API lo traduce a código, que es como las guarda.
    const suc = session?.isGlobalAdmin ? getSucursalActiva() : session?.sucursalId;
    const q = suc ? `?sucursalId=${encodeURIComponent(suc)}` : "";

    fetch(`${getApiBaseUrl()}/tasa${q}`)
      .then((r) => r.json())
      .then((d) => {
        // Sin tasa de ESTA sucursal, el selector CUP se queda apagado con el motivo a la
        // vista. Antes caía a la general y Granma enseñaba los 685 de La Habana como si
        // fueran suyos: un importe así se lee bien y está mal, que es lo peor que puede
        // pasarle a un número que alguien va a cobrar.
        setTasa(d?.cupPorUsd ?? null);
        setTasaVieja(d?.aviso ?? null);
      })
      .catch(() => {
        /* sin tasa se sigue viendo en USD */
      });
  }, []);

  useEffect(() => {
    setMoneda(monedaGuardada());
    traerTasa();
  }, [traerTasa]);

  // Y cuando el worker la cambia, la pantalla se entera sola. El evento sólo trae el
  // aviso: se vuelve a pedir para no fiarse de un número que viajó por otro camino.
  useLiveEvents(["tasa"], traerTasa);


  

  // El importe, ya en la moneda elegida.

  const $$ = (usd: number | null | undefined) => importe(usd, moneda, tasa);

  /**
   * El detalle guarda el ID, no una copia del pedido.
   *
   * Guardaba el objeto entero, y eso lo dejaba congelado en el momento de abrirlo: si
   * mientras lo mirabas entraba el costo del domicilio, la LISTA de detrás se
   * actualizaba —el SSE la refresca— pero el detalle abierto seguía diciendo «sin
   * calcular». Dos números distintos del mismo pedido en la misma pantalla, y el de
   * delante era el viejo.
   */
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [orderToComplete, setOrderToComplete] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const live = useLiveStatus(); // estado de la conexión SSE compartida de la app
  const [nuevosPend, setNuevosPend] = useState(0); // pedidos nuevos no mostrados (con filtros/otra página)
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Pulsar fuera cierra; elegir en un desplegable NO (se dibuja fuera del modal).
  useCerrarAlPulsarFuera(isOpen, onClose);

  /**
   * EN MÓVIL Y TABLET, CAJÓN. EN ESCRITORIO, MODAL.
   *
   * En pantalla pequeña un modal se come el sitio, deja el contenido apretado y el
   * gesto de cerrar no cae donde la mano espera. El cajón entra desde el borde, ocupa
   * lo que necesita y se cierra arrastrando.
   *
   * Es el MISMO contenido en los dos: sólo cambia el envase. Duplicar la pantalla para
   * la versión pequeña es cómo se acaba con dos detalles de pedido que dicen cosas
   * distintas — uno se arregla y el otro no.
   */
  const pantallaChica = usePantallaChica();

  /**
   * `ElementType` y no el tipo de cada componente: `Modal` y `Drawer` no aceptan las
   * mismas props —el cajón se coloca a la derecha y el modal no sabe qué es eso— y
   * TypeScript, al unirlos, se queda con las del modal y rechaza el cajón. Aquí no hay
   * nada que ganar peleándose con eso: las props se eligen justo debajo, a mano, según
   * cuál de los dos sea.
   */
  const Envase: ElementType = pantallaChica ? Drawer : Modal;
  const EnvaseContenido: ElementType = pantallaChica ? DrawerContent : ModalContent;
  const EnvaseCabecera: ElementType = pantallaChica ? DrawerHeader : ModalHeader;
  const EnvaseCuerpo: ElementType = pantallaChica ? DrawerBody : ModalBody;
  const EnvasePie: ElementType = pantallaChica ? DrawerFooter : ModalFooter;

  /**
   * SI LA NOTA DE LA FACTURA ESTÁ ABIERTA.
   *
   * Se abre sola cuando la factura NO coincide con el pedido, que es cuando hay algo que
   * mirar. Cuando coincide se queda cerrada: abrir un panel para decir «todo bien» es
   * hacer trabajar al que mira para no enterarse de nada. El botón sigue estando, para
   * el día que alguien discuta lo que se llevó.
   */
  const [verFactura, setVerFactura] = useState(false);
  const {
    isOpen: isConfirmOpen,
    onOpen: onConfirmOpen,
    onClose: onConfirmClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteConfirmOpen,
    onOpen: onDeleteConfirmOpen,
    onClose: onDeleteConfirmClose,
  } = useDisclosure();
  const {
    isOpen: isReabrirConfirmOpen,
    onOpen: onReabrirConfirmOpen,
    onClose: onReabrirConfirmClose,
  } = useDisclosure();
  const { session } = useAuthStore();

  // Quién borra un pedido: el MISMO trío que acepta el servidor
  // (`puedeBorrarPedidos` en api/src/lib/sucursalContext.ts): Super Admin,
  // Administrador y Supervisor.
  //
  // El SUPER ADMIN faltaba aquí. El endpoint le dejaba borrar, pero esta lista le
  // escondía el botón, así que desde la app no podía borrar NINGÚN pedido, de
  // ninguna sucursal ni en ningún estado. `isGlobalAdmin` cubre además al usuario
  // semilla `admin`, que el servidor trata como Super Admin aunque su rol no lo
  // diga.
  const canDeleteOrders =
    session?.isGlobalAdmin === true ||
    session?.rol === "SUPER ADMIN" ||
    session?.rol === "ADMINISTRADOR" ||
    session?.rol === "SUPERVISOR";

  // El GESTOR sube los pedidos de SUS vendedores y los ve, pero no los cierra:
  // completar es decir "esto ya se facturó", y eso lo dice quien factura (el
  // Operador) o quien lleva la sucursal. El servidor lo rechaza igual — esto
  // solo evita enseñarle un botón que le va a dar error.
  const puedeCompletar = session?.rol !== "GESTOR";

  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;

  const filtros: FiltrosPedidos = {
    page,
    estados: estadosSel,
    repartos: repartosSel,
    facturas: facturasSel,
    search: debouncedSearch,
    fechaDesde,
    fechaHasta,
    domicilio: domicilioFilter,
    vendedor: vendedorFilter,
    producto: productoFilter,
    incluirArchivados,
  };

  // Sin filtros = primera pagina y orden por fecha: ahi SI se puede insertar un
  // pedido nuevo arriba sin mentir sobre lo que la lista dice estar enseniando.
  // Con filtros solo se cuenta y se avisa ("hay N nuevos").
  const sinFiltros =
    page === 1 &&
    !debouncedSearch &&
    marcados === 0 &&
    domicilioFilter === "todos" &&
    vendedorFilter === "todos" &&
    !fechaDesde &&
    !fechaHasta;

  // La lista vive en el store: cada combinacion de pagina + filtros se cachea por
  // separado, asi que volver a una consulta ya vista es instantaneo en vez de
  // costar otra vuelta al servidor.
  const {
    datos,
    cargando: isLoading,
    error,
    recargar: fetchOrders,
  } = usarPedidos(
    clavePedidos(filtros, activeSucursalId ?? "todas"),
    traerPedidos(filtros),
    {
      tipos: ["pedido"],
      aplicar: (actual, lote) => {
        const lista = aplicarLote<Order>(actual.data, lote, {
          alPrincipio: sinFiltros,
        });

        if (lista === null) return null;

        if (!sinFiltros) {
          // Los pedidos nuevos que NO caben en la vista filtrada se cuentan aparte.
          const nuevos = lote.filter(
            (e) =>
              e.accion === "create" && !actual.data.some((o) => o.id === e.id),
          ).length;

          if (nuevos) setNuevosPend((n) => n + nuevos);
        }

        return lista === actual.data ? actual : { ...actual, data: lista };
      },
    },
  );

  const orders = datos?.data ?? SIN_PEDIDOS;
  const pagination = datos?.pagination ?? PAGINACION_VACIA;

  /**
   * El pedido del detalle, sacado SIEMPRE de la lista viva.
   *
   * Así, cuando el SSE trae el costo del domicilio, el detalle abierto se entera en el
   * mismo momento que la fila de detrás — que era lo que fallaba: el de fuera decía
   * $0.73 y el de dentro seguía en «sin calcular».
   */
  const vivo = selectedOrderId
    ? (orders.find((o) => o.id === selectedOrderId) ?? null)
    : null;

  // Y si el pedido se sale del filtro mientras lo tienes abierto —al completarlo, por
  // ejemplo— se sigue enseñando lo último que se sabía de él. Sin esto, el detalle se
  // quedaría en blanco de golpe justo después de darle a un botón, que parece un fallo.
  const ultimo = useRef<Order | null>(null);

  if (vivo) ultimo.current = vivo;
  const selectedOrder: Order | null =
    vivo ?? (selectedOrderId ? ultimo.current : null);

  /**
   * El peso del pedido entero, y cuántas líneas no lo traen.
   *
   * Suma lo que hay, no lo que debería haber: los productos sin peso en Ventra —hoy 72
   * de los 128— no se pueden estimar, y ponerles un cero los haría desaparecer de la
   * cuenta sin que nadie lo note. Por eso se enseña el total Y las que faltan.
   */
  // Cada pedido decide si su nota nace abierta. Sin esto, la nota que abrió el pedido
  // anterior se quedaría abierta sobre el siguiente, con la factura de otro cliente.
  useEffect(() => {
    setVerFactura(selectedOrder?.facturaEstado === "cambiado");
  }, [selectedOrder?.id, selectedOrder?.facturaEstado]);

  /**
   * SI LA NOTA SE VE, DE VERDAD.
   *
   * `verFactura` es lo que alguien pidió; esto es lo que corresponde a ESTE pedido. El
   * efecto de arriba corrige el interruptor, pero corre DESPUÉS de pintar: abriendo un
   * pedido que no cambió justo detrás de uno que sí, la nota alcanzaba a dibujarse y se
   * cerraba sola con su animación. Un parpadeo que parece un fallo, y encima enseña
   * medio segundo la factura del cliente anterior.
   *
   * Derivándolo, no hay instante intermedio: un pedido que no cambió no puede enseñar
   * nota aunque el interruptor venga encendido de antes.
   */
  const notaAbierta = verFactura && selectedOrder?.facturaEstado === "cambiado";


  /**
   * Esc cierra PRIMERO la nota, y sólo cierra el pedido si la nota ya estaba cerrada.
   *
   * En fase de captura para llegar antes que el modal, que también escucha Esc. Sin
   * esto, quien abre la factura y pulsa Esc pierde el pedido entero y tiene que buscarlo
   * otra vez en la lista.
   */
  useEffect(() => {
    if (!notaAbierta) return;

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setVerFactura(false);
    };

    document.addEventListener("keydown", alPulsar, true);

    return () => document.removeEventListener("keydown", alPulsar, true);
  }, [notaAbierta]);

  const lineasSinPeso =
    selectedOrder?.items.filter((i) => i.pesoLineaKg == null).length ?? 0;
  const conPeso = selectedOrder?.items.filter((i) => i.pesoLineaKg != null) ?? [];
  const pesoDelPedido = conPeso.length
    ? Number(conPeso.reduce((t, i) => t + (i.pesoLineaKg ?? 0), 0).toFixed(2))
    : null;

  /**
   * @param fondo  recarga silenciosa: sin esqueleto y sin pintar errores. La usa el
   *               SSE cuando llega un cambio masivo que no se puede aplicar en sitio.
   */

  /**
   * Aquí estaba escribir a mano el número de factura.
   *
   * Se quitó: el número lo pone el cotejo por el folio que Ventra escribe en la nota, y
   * dejar cambiarlo a mano es invitar a atar la factura de uno al pedido de otro — que es
   * exactamente el error que costó caro en julio.
   */

  const handleCompletarOrder = useCallback(
    async (orderId: string) => {
      try {
        const response = await fetch(
          `${getApiBaseUrl()}/orders/${orderId}/completar`,
          {
            method: "PATCH",
          },
        );

        if (!response.ok) {
          // El mensaje del SERVIDOR, no uno inventado aqui. Antes se tiraba y
          // siempre se veia "Error al completar el pedido", asi que daba igual
          // que la sesion hubiera caducado, que el pedido fuera de otra
          // sucursal o que faltara permiso: nadie podia saber que pasaba.
          throw new Error(
            await mensajeDeError(response, "No se pudo completar el pedido"),
          );
        }

        // Refetch current page and close modals
        void fetchOrders(true);
        onClose();
        onConfirmClose();
        setOrderToComplete(null);
      } catch (err) {
        addToast({
          title: "No se completó",
          description:
            err instanceof Error ? err.message : "No se pudo completar el pedido",
          color: "danger",
        });
      }
    },
    [fetchOrders, onClose, onConfirmClose],
  );

  /**
   * Reabrir un pedido completado.
   *
   * Completar es un clic en una lista larga: se hace sin querer, o se completa el de
   * arriba creyendo que era el de abajo. Hasta ahora no había vuelta atrás y el
   * arreglo era pedirle a alguien que lo tocara en la base de datos.
   */
  const handleReabrirOrder = useCallback(
    async (orderId: string) => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/orders/${orderId}/estado`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "en_proceso" }),
        });

        if (!response.ok) {
          throw new Error(
            await mensajeDeError(response, "No se pudo reabrir el pedido"),
          );
        }

        void fetchOrders(true);
        onClose();
        addToast({
          title: "Pedido reabierto",
          description: "Vuelve a estar en proceso.",
          color: "success",
        });
      } catch (err) {
        addToast({
          title: "No se reabrió",
          description:
            err instanceof Error ? err.message : "No se pudo reabrir el pedido",
          color: "danger",
        });
      }
    },
    [fetchOrders, onClose],
  );

  const handleDeleteOrder = useCallback(
    async (orderId: string) => {
      setIsDeleting(true);
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${getApiBaseUrl()}/orders/${orderId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json();

          throw new Error(data.error || "Error al eliminar el pedido");
        }

        addToast({
          title: "Pedido eliminado",
          description: "El pedido ha sido eliminado correctamente.",
          color: "success",
        });

        // Refetch current page and close modals
        void fetchOrders(true);
        onClose();
        onDeleteConfirmClose();
        setOrderToDelete(null);
        setSelectedOrderId(null);
      } catch (err) {
        addToast({
          title: "Error",
          description:
            err instanceof Error ? err.message : "Error al eliminar el pedido",
          color: "danger",
        });
      } finally {
        setIsDeleting(false);
      }
    },
    [fetchOrders, onClose, onDeleteConfirmClose],
  );

  const handleAskConfirmDelete = useCallback(
    (order: Order) => {
      setOrderToDelete(order);
      onDeleteConfirmOpen();
    },
    [onDeleteConfirmOpen],
  );

  const handleAskConfirmComplete = useCallback(
    (order: Order) => {
      setOrderToComplete(order);
      onConfirmOpen();
    },
    [onConfirmOpen],
  );

  /**
   * Devolver un pedido a "en proceso", preguntando antes.
   *
   * Se pregunta porque en los EXPIRADOS no es solo cambiar una etiqueta: expirado no
   * es un estado guardado, sale de que la fecha comprometida ya pasó. Para que deje
   * de estar vencido hay que quitarle esa fecha, y eso se avisa en el texto en vez de
   * hacerlo por detrás — enterarse después de que desapareció una fecha es peor que
   * el problema que venía a resolver.
   */
  const handleAskConfirmReabrir = useCallback(
    (order: Order) => {
      setOrderToReabrir(order);
      onReabrirConfirmOpen();
    },
    [onReabrirConfirmOpen],
  );

  const handleOpenDetails = useCallback(
    (order: Order) => {
      setSelectedOrderId(order.id);
      onOpen();
    },
    [onOpen],
  );

  const handleCopyFromList = useCallback(async (order: Order) => {
    const vendedorNombre = order.vendedor?.nombre || "Sin vendedor";
    const clienteCodigo =
      order.cliente?.codigo || order.cliente?.nombre || "Sin cliente";
    const text = `P-${order.folio}; V-${vendedorNombre}; C-${clienteCodigo};`;

    const ok = await copyTextToClipboard(text);

    if (ok) {
      // Esta es la copia que se pega en la observacion de la factura: la que
      // mide el uso real del puente con el sistema contable.
      registrarCopia({
        tipo: "pedido",
        pedidoId: order.id,
        vendedorId: order.vendedor?.id,
        clienteId: order.cliente?.id,
      });
      setCopiedOrderId(order.id);
      setTimeout(() => setCopiedOrderId(null), 2000);
    } else {
      addToast({
        title: "Error al copiar",
        description:
          "No se pudo copiar automáticamente. Abre el pedido para copiar manualmente.",
        color: "warning",
      });
    }
  }, []);

  // Debounced search with cleanup
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  // Lista para el filtro (desplegable) — el USUARIO/gestor vinculado, uno por persona,
  // scopeado a la sucursal (así no salen dos "Alexander" por encoding distinto).
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/vendedores/usuarios`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v: VendedorOpt[]) => setVendedores(Array.isArray(v) ? v : []))
      .catch(() => setVendedores([]));
  }, []);
  // Al cambiar un filtro se vuelve a la primera pagina: la 7 de una busqueda no
  // significa nada en la siguiente. El store pide lo que falte al cambiar la clave.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    estadosSel,
    repartosSel,
    facturasSel,
    domicilioFilter,
    vendedorFilter,
    fechaDesde,
    fechaHasta,
    incluirArchivados,
  ]);

  // Pedidos en tiempo real: lo lleva el store (opcion `aplicar` de arriba). Va por
  // la conexion SSE UNICA de la app; antes esta vista abria su PROPIO EventSource
  // contra /orders/stream, que ademas escuchaba un canal de Redis que nadie
  // publicaba: el indicador salia verde y no llegaba jamas un pedido.

/*
                        LA NOTA SÓLO SALE CUANDO HAY ALGO QUE MIRAR.
  
                        Si la factura coincide con el pedido, la nota repetiría la lista
                        que ya está a la izquierda, producto por producto. Eso no informa:
                        hace leer dos veces lo mismo para acabar donde se empezó. Lo que
                        hay que saber —que se mantiene— cabe en la línea verde de arriba.
  
                        Estuvo saliendo también en ese caso, asomando por detrás, y la
                        primera vez que se vio en pantalla sobraba.
                      */
  /**
   * LA NOTA DE LA FACTURA, una sola vez.
   *
   * En escritorio va como segunda tarjeta al lado del pedido. En móvil no cabe al
   * lado y colgarla debajo la convierte en «más pedido»: se lee como si siguiera la
   * lista de productos, que es justo lo que no es. Ahí se abre en SU PROPIO cajón,
   * encima del pedido.
   *
   * Se declara una vez y se usa en los dos sitios. Escribirla dos veces es cómo se
   * acaba con una versión que se arregla y otra que no.
   */
  const notaFactura = selectedOrder?.facturaEstado === "cambiado" &&
                        selectedOrder?.lineasFactura && (
                        /*
                          LA NOTA SIEMPRE ESTÁ. Cerrada, asoma por detrás de la tarjeta del
                          pedido; abierta, sale de ahí y se pone al lado.
  
                          Es la diferencia entre un panel que aparece de la nada —y que hay
                          que saber que existe para ir a buscarlo— y una carpeta que se ve
                          que está ahí desde que abres el pedido.
  
                          El truco es el margen negativo: cerrada se mete 25rem por debajo
                          de la tarjeta del pedido, que es opaca y va por delante (`z-10`),
                          y sólo queda asomando el canto. Abierta, ese margen pasa a ser el
                          hueco entre las dos. `transition-all` hace el resto.
  
                          En móvil no hay sitio para las dos al lado, así que ahí no asoma:
                          o está abierta, debajo del pedido, o no está.
                        */
                        <aside
                          aria-hidden={!notaAbierta}
                          data-tarjeta="factura"
                          className={`z-0 shrink-0 flex-col gap-2 self-start rounded-large border-t-4 border-success-400 bg-content1 p-4 shadow-medium transition-all duration-300 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:w-[26rem] lg:overflow-y-auto ${
                            notaAbierta
                              ? "mt-4 flex lg:mt-0 lg:ml-4"
                              : "hidden lg:-ml-[25rem] lg:cursor-pointer"
                          }`}
                          onClick={notaAbierta ? undefined : () => setVerFactura(true)}
                        >
                          <div className="flex items-start justify-between gap-2 border-b border-success-200 pb-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-success-600">
                                Factura de Ventra
                              </p>
                              {/* El número NO se edita. Lo pone el cotejo, por el folio que
                                  Ventra escribe en la nota de la factura; escrito a mano
                                  sólo puede desmentir al papel de verdad. */}
                              <p className="font-mono text-lg font-semibold break-all">
                                {selectedOrder.facturaNumero ?? "—"}
                              </p>
                            </div>
                            {/* Su propia ✕: cierra LA NOTA y deja el pedido abierto. La del
                                modal sigue arriba a la derecha y cierra todo. */}
                            <Button
                              isIconOnly
                              aria-label="Cerrar la factura"
                              radius="full"
                              size="sm"
                              variant="light"
                              onPress={() => setVerFactura(false)}
                            >
                              <span aria-hidden className="text-base leading-none">
                                ✕
                              </span>
                            </Button>
                          </div>
  
                          {lineasDeFactura(selectedOrder.lineasFactura).map((l, i) => {
                            const estilo = estiloLinea[l.marca ?? "igual"] ?? estiloLinea.igual;
                            const nota = notaDeLinea(l);
  
                            return (
                              <div
                                key={`${l.producto}-${i}`}
                                className={`rounded-lg border-l-4 px-3 py-2 ${estilo.caja}`}
                              >
                                <p className="break-words text-sm font-medium">{l.producto}</p>
                                {/* Lo mismo que se enseña de cada producto del pedido:
                                    formatos, unidades, kilos e importe. Con menos, comparar
                                    las dos listas obliga a abrir Ventra. Una línea `falta`
                                    no lleva cifras: no está en la factura, y unos ceros ahí
                                    se leerían como que se facturó nada de algo. */}
                                {l.marca !== "falta" && (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                    <Chip size="sm" variant="flat">
                                      {l.cantidad} formatos
                                    </Chip>
                                    <Chip size="sm" variant="flat">
                                      {l.unidades == null ? "—" : `${l.unidades} unidades`}
                                    </Chip>
                                    <Chip size="sm" variant="flat">
                                      {l.pesoKg == null ? "—" : `${l.pesoKg} kg`}
                                    </Chip>
                                    {l.importe != null && (
                                      <span className="ml-auto font-semibold text-default-700">
                                        {$$(l.importe)}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {nota && (
                                  <p className={`mt-1 text-[11px] font-semibold ${estilo.texto}`}>
                                    {nota}
                                  </p>
                                )}
                              </div>
                            );
                          })}
  
                          {/*
                            EL REPARTO, COMO UNA LÍNEA MÁS DE LA FACTURA.
  
                            Ventra lo factura así —un producto de servicio— y el cotejo lo
                            aparta antes de comparar, porque nunca está en el pedido y con
                            él dentro TODOS los pedidos a domicilio salían «cambiados».
                            Apartarlo para comparar está bien; esconderlo también, no: es
                            dinero que el cliente pagó y que no aparecía por ningún lado.
                          */}
                          {selectedOrder.facturaDomicilio != null && (
                            <div className="rounded-lg border-l-4 border-primary-400 bg-primary-50 px-3 py-2">
                              <p className="break-words text-sm font-medium">
                                ENTREGA A DOMICILIO
                              </p>
                              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                                <span className="text-default-500">Servicio</span>
                                <span className="font-semibold text-default-700 tabular-nums">
                                  {$$(selectedOrder.facturaDomicilio)}
                                </span>
                              </div>
                            </div>
                          )}
  
                          {(() => {
                            const r = resumenFactura(
                              lineasDeFactura(selectedOrder.lineasFactura),
                            );
                            const reparto = selectedOrder.facturaDomicilio ?? 0;
  
                            return (
                              <div className="mt-1 flex items-center justify-between rounded-lg bg-success-50 px-3 py-2">
                                <div>
                                  <p className="text-sm font-semibold text-success-700">
                                    Total de la factura
                                  </p>
                                  <p className="text-[11px] text-default-500 tabular-nums">
                                    {r.formatos} formatos
                                    {r.conUnidades > 0 ? ` · ${r.unidades} unidades` : ""}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="font-semibold text-success-700 tabular-nums">
                                    {r.conImporte > 0 || reparto > 0
                                      ? $$(r.importe + reparto)
                                      : "—"}
                                  </p>
                                  {/* Desglosado sólo cuando hay reparto: si no, la resta
                                      sobra y el total se lee de un vistazo. */}
                                  {reparto > 0 && (
                                    <p className="text-[11px] text-default-500 tabular-nums">
                                      {$$(r.importe)} de mercancía + {$$(reparto)} de reparto
                                    </p>
                                  )}
                                  {r.conPeso > 0 && (
                                    <p className="text-xs text-default-500 tabular-nums">
                                      {r.kg} kg
                                    </p>
                                  )}
                                  {/* Y se dice POR QUÉ no hay cifras, en vez de dejar un
                                      guion mudo que parece un fallo de ahora mismo. */}
                                  {r.conImporte === 0 && (
                                    <p className="text-[11px] text-default-400">
                                      cotejada antes de que se guardara el detalle
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
  
                          {/*
                            EL DOMICILIO RECALCULADO VA AQUÍ, NO ARRIBA EN EL PEDIDO.
  
                            La APK cotizó el reparto por lo que pesaba el PEDIDO. Si la
                            factura pesa otra cosa, ese precio se hizo sobre algo que no va a
                            subir al camión — y enseñarlo arriba, en la línea de entrega,
                            como un importe normal es decir que vale cuando ya no vale.
  
                            Así que arriba queda un aviso que trae hasta aquí, y el número
                            viejo se enseña donde se puede explicar: al lado del peso nuevo.
  
                            El reparto es NUESTRO servicio, no una línea de Ventra: lo
                            calcula la APK de Entrega con su tarifa. Aquí no se inventa un
                            precio ni se copia ninguno — se dice cuál era, por qué ya no
                            vale, y que el nuevo viene de la APK.
                          */}
                          {selectedOrder.facturaEstado === "cambiado" &&
                            (selectedOrder.costoDomicilio != null ||
                              selectedOrder.facturaDomicilio != null) && (
                              <div className="rounded-lg border-l-4 border-primary-400 bg-primary-50 px-3 py-2">
                                <p className="text-xs font-semibold text-primary-700">
                                  Entrega a domicilio · hay que rehacerla
                                </p>
                                <p className="mt-1 text-xs text-default-600 tabular-nums">
                                  {selectedOrder.costoDomicilio == null
                                    ? "La APK todavía no le había puesto precio al reparto."
                                    : `Estaba en ${$$(selectedOrder.costoDomicilio)}${
                                        pesoDelPedido != null
                                          ? `, por los ${pesoDelPedido} kg del pedido`
                                          : ""
                                      }.`}
                                </p>
                                {(() => {
                                  const kg = resumenFactura(
                                    lineasDeFactura(selectedOrder.lineasFactura),
                                  ).kg;
                                  // Sin el peso del pedido no hay resta que hacer: se dice
                                  // lo que pesa la factura y ya. Restar contra un cero daría
                                  // «173.88 kg más» sobre un pedido que sólo está a medio pesar.
                                  const dif =
                                    pesoDelPedido == null
                                      ? null
                                      : Number((kg - pesoDelPedido).toFixed(2));
  
                                  return (
                                    <p className="text-xs text-default-600 tabular-nums">
                                      La factura pesa {kg} kg
                                      {dif == null
                                        ? ""
                                        : dif === 0
                                          ? " — el mismo peso"
                                          : ` — ${Math.abs(dif)} kg ${dif > 0 ? "más" : "menos"}`}
                                      .
                                    </p>
                                  );
                                })()}
                                <p className="mt-1 text-[11px] font-semibold text-primary-700">
                                  Se le avisó a Entrega. El precio nuevo lo pone la APK y sale
                                  aquí en cuanto lo mande.
                                </p>
                              </div>
                            )}
                        </aside>
      );


  return (
    <div className="flex flex-col w-full gap-4">
      {/* En qué moneda se ven los importes.
          Arriba del todo y siempre visible: si estuviera escondido en un menú, alguien
          leería un total en CUP creyendo que son dólares. La diferencia son dos órdenes
          de magnitud. */}
      <div className="flex items-center justify-end gap-2">
        {tasaVieja && (
          <Chip color="warning" size="sm" variant="flat">
            {tasaVieja}
          </Chip>
        )}
        {tasa != null && moneda === "CUP" && (
          <span className="text-xs text-default-400">1 USD = {tasa} CUP</span>
        )}
        <Tabs
          aria-label="Moneda"
          selectedKey={moneda}
          size="sm"
          onSelectionChange={(k: React.Key) => {
            const m = String(k) as Moneda;

            setMoneda(m);
            guardarMoneda(m);
          }}
        >
          <Tab key="USD" title="USD" />
          {/* Sin tasa no se ofrece CUP: enseñar la pestaña y que al pulsarla no cambie
              nada es peor que no tenerla. */}
          <Tab key="CUP" isDisabled={!tasa} title="CUP" />
        </Tabs>
      </div>

      {/* Filters */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <Input
              isClearable
              className="flex-1"
              label="Buscar Pedido"
              placeholder="Buscar por folio, vendedor, cliente, código, encargado o PRODUCTO..."
              size="lg"
              startContent={
                <Icons.search className="size-5 text-default-400" />
              }
              value={searchValue}
              variant="bordered"
              onChange={(e) => setSearchValue(e.target.value)}
              onClear={() => setSearchValue("")}
            />
            {/*
              LOS TRES ESTADOS, EN UN SOLO SITIO Y CON CASILLAS.

              Eran tres desplegables seguidos y la barra ya no daba para más: entre
              buscar, producto, domicilio, vendedor y las dos fechas, tres más dejaban
              los campos partidos y el de facturación medio tapado.

              Y de uno en uno no se puede preguntar lo que se pregunta de verdad —«qué
              hay en proceso O expirado», «qué se devolvió O se canceló»—, porque un
              desplegable sólo deja escoger uno. Con casillas se marcan los que sean, y
              cada grupo se cruza con los otros: pedido Y reparto Y factura.
            */}
            {/* `h-14` y `border-medium`: es lo que mide y cómo se dibuja un Input `lg`
                con borde. Con el `lg` del Button quedaba más bajo y con el borde más
                fino que el buscador de al lado, y dos controles pegados que no coinciden
                se ven antes que cualquier otra cosa de la pantalla. */}
            <Button
              className="h-14 w-full justify-between rounded-medium border-medium px-4 sm:w-56"
              variant="bordered"
              onPress={abrirCajonDeFiltros}
            >
              <span className="flex items-center gap-2">
                <Icons.filter className="size-4 text-default-400" />
                Filtros
              </span>
              {/* El número de aplicados: con el cajón cerrado, es lo único que dice que
                  la lista está filtrada. Sin él se mira una lista corta creyendo que
                  están todos. */}
              {marcados > 0 && (
                <Chip color="primary" size="sm" variant="flat">
                  {marcados}
                </Chip>
              )}
            </Button>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Input
              isClearable
              className="flex-1"
              label="Fecha desde"
              size="lg"
              type="date"
              value={fechaDesde}
              variant="bordered"
              onChange={(e) => setFechaDesde(e.target.value)}
              onClear={() => setFechaDesde("")}
            />
            <Input
              isClearable
              className="flex-1"
              label="Fecha hasta"
              size="lg"
              type="date"
              value={fechaHasta}
              variant="bordered"
              onChange={(e) => setFechaHasta(e.target.value)}
              onClear={() => setFechaHasta("")}
            />
          </div>
        </CardBody>
      </Card>

      {/* Barra de tiempo real (SSE) */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs",
            live
              ? "bg-success-100 text-success-700"
              : "bg-default-100 text-default-500",
          )}
        >
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              live ? "bg-success-500 animate-pulse" : "bg-default-400",
            )}
          />
          {live ? "En vivo" : "Conectando…"}
        </span>
        {nuevosPend > 0 && (
          <Button
            color="primary"
            size="sm"
            startContent={<Icons.receipt className="size-4" />}
            variant="flat"
            onPress={() => {
              setNuevosPend(0);
              setPage(1);
            }}
          >
            {nuevosPend} pedido{nuevosPend > 1 ? "s" : ""} nuevo
            {nuevosPend > 1 ? "s" : ""} — actualizar
          </Button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody className="py-6 text-center">
            <p className="text-danger">{error}</p>
            <Button
              className="mt-4"
              color="primary"
              onPress={() => fetchOrders()}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Orders List */}
      {!isLoading && !error && (
        <>
          <div className="flex flex-col gap-4">
            {orders.map((order) => (
              <Card
                key={order.id}
                className={cn(
                  cards({ border: estadoColors[order.estado] }),
                  "overflow-visible",
                )}
              >
                <CardBody className="relative gap-4 overflow-visible">
                  {/*
                    Las etiquetas del pedido.

                    En pantalla grande van COLGADAS del borde de la tarjeta, una fila a
                    cada lado. En el móvil no caben: la de la izquierda y la de la derecha
                    se montaban una encima de otra y no había forma de leer ninguna.

                    Así que abajo de `sm` esto es una fila normal que se parte en varias
                    líneas, y a partir de `sm` el envoltorio desaparece (`contents`) y cada
                    grupo vuelve a colocarse contra el borde como antes.
                  */}
                  <div className="flex flex-wrap items-center gap-1 sm:contents">
                    <div className="flex flex-wrap items-center gap-1 sm:absolute sm:top-0 sm:left-0 sm:z-10 sm:flex-nowrap">
                      <Chip
                        className={`chip-${estadoColors[order.estado]} sm:-translate-y-7`}
                        color={estadoColors[order.estado]}
                        size="sm"
                        variant="dot"
                      >
                        {estadoLabels[order.estado]}
                      </Chip>
                      {order.archivedAt && (
                        <Chip
                          className="sm:-translate-y-7"
                          color="default"
                          size="sm"
                          variant="flat"
                        >
                          Archivado
                        </Chip>
                      )}
                      {chipDeFactura(order) && (
                          <Tooltip
                            content={
                              order.facturaCorregidoAt
                                ? `El pedido se reescribió con lo que dice la factura ${order.facturaNumero ?? ""}. Lo que tomaste se guardó.`
                                : order.facturaNumero
                                  ? `Factura ${order.facturaNumero}`
                                  : "Comprobado contra la facturación de Ventra"
                            }
                          >
                            <Chip
                              className="sm:-translate-y-7"
                              color={chipDeFactura(order)!.color}
                              size="sm"
                              variant="flat"
                            >
                              {chipDeFactura(order)!.texto}
                            </Chip>
                          </Tooltip>
                        )}
                      {order.estadoEntrega &&
                        entregaChip[order.estadoEntrega] && (
                          <Tooltip
                            content={
                              order.estadoEntregaNota ||
                              "Lo pone delivery según va la ruta"
                            }
                          >
                            <Chip
                              className="sm:-translate-y-7"
                              color={entregaChip[order.estadoEntrega].color}
                              size="sm"
                              variant="flat"
                            >
                              {entregaChip[order.estadoEntrega].texto}
                            </Chip>
                          </Tooltip>
                        )}
                    </div>
                    {(order.costoDomicilio != null ||
                      order.requiere_domicilio) && (
                      <div className="flex flex-wrap items-center gap-1.5 sm:absolute sm:top-0 sm:right-0 sm:z-10 sm:flex-nowrap sm:-translate-y-7">
                        {/* El TOTAL, al lado del domicilio y no sólo dentro del pedido.
                            Es el número por el que se pregunta —"¿cuánto es este
                            pedido?"— y tenerlo que abrir uno por uno para verlo hacía
                            inútil la lista. */}
                        {order.total != null && (
                          <Chip color="default" size="sm" variant="flat">
                            Total: {$$(order.total)}
                            {(order.lineasSinPrecio ?? 0) > 0 && " *"}
                          </Chip>
                        )}
                        <Chip
                          color={
                            order.costoDomicilio != null ? "success" : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {order.costoDomicilio != null
                            ? `Domicilio: ${$$(order.costoDomicilio)}`
                            : "Domicilio sin calcular"}
                        </Chip>
                      </div>
                    )}
                  </div>
                  <div className="grid items-start justify-between w-full grid-cols-1 gap-4 md:grid-cols-4">
                    <div className="flex items-center gap-2">
                      <Icons.receipt className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Pedido:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.folio}
                        </span>
                        {/* La fecha del pedido, aquí: en la lista se busca "los de
                            ayer" o "los que llevan una semana", y sin ella hay que
                            abrir uno por uno para averiguarlo. */}
                        <span className="text-xs text-default-500">
                          {comoSeLeeElDia(order.fecha) ?? ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Icons.workers className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Vendedor:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.vendedor?.nombre ?? "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Icons.client className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Cliente:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.encargado ?? "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-6 pt-1 md:justify-end">
                      <Tooltip
                        color={
                          copiedOrderId === order.id ? "success" : "default"
                        }
                        content={
                          copiedOrderId === order.id
                            ? "¡Copiado!"
                            : "Copiar Pedido"
                        }
                      >
                        <Button
                          aria-label="Copiar Pedido"
                          className="p-0"
                          color={
                            copiedOrderId === order.id ? "success" : "default"
                          }
                          isIconOnly={true}
                          variant="ghost"
                          onPress={() => handleCopyFromList(order)}
                        >
                          {copiedOrderId === order.id ? (
                            <Icons.check className="size-6" />
                          ) : (
                            <Icons.copy className="size-6" />
                          )}
                        </Button>
                      </Tooltip>
                      <Tooltip content="Ver Detalles">
                        <Button
                          aria-label="Ver Detalles"
                          className="p-0"
                          color="primary"
                          isIconOnly={true}
                          variant="ghost"
                          onPress={() => handleOpenDetails(order)}
                        >
                          <Icons.eye className="size-6" />
                        </Button>
                      </Tooltip>
                      {puedeCompletar && order.estado === "en_proceso" && (
                        <Tooltip content="Completar Pedido">
                          <Button
                            aria-label="Completar Pedido"
                            className="p-0"
                            color="primary"
                            isIconOnly={true}
                            variant="solid"
                            onPress={() => handleAskConfirmComplete(order)}
                          >
                            <Icons.check className="text-white size-6" />
                          </Button>
                        </Tooltip>
                      )}
                      {/* Volver a ponerlo en proceso, aquí mismo y sin abrirlo.
                          Completar es un clic en una lista larga: se hace sin querer
                          o se completa el de arriba creyendo que era el de abajo, y
                          si deshacerlo obliga a abrir el pedido y buscar el botón
                          dentro, en la práctica nadie lo deshace. */}
                      {puedeCompletar && order.estado !== "en_proceso" && (
                        <Tooltip content="Volver a En proceso">
                          <Button
                            aria-label="Volver a En proceso"
                            className="p-0"
                            color="warning"
                            isIconOnly={true}
                            variant="flat"
                            onPress={() => handleAskConfirmReabrir(order)}
                          >
                            <Icons.back className="size-6" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Empty State */}
          {orders.length === 0 && (
            <Card className={cards({ border: "default" })}>
              <CardBody className="py-6 text-center">
                <p className="text-default-500">
                  No se encontraron pedidos con los filtros aplicados
                </p>
              </CardBody>
            </Card>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center w-full">
              <Pagination
                isCompact
                showControls
                showShadow
                classNames={{
                  wrapper: "shadow-xl shadow-primary/5",
                  item: "cursor-pointer font-semibold",
                  cursor: "font-semibold",
                }}
                color="primary"
                page={pagination.page}
                siblings={1}
                size="lg"
                total={pagination.totalPages}
                onChange={setPage}
              />
            </div>
          )}

          {/* Pagination Info */}
          <div className="flex justify-center text-sm text-default-500">
            Mostrando {orders.length} de {pagination.total} pedidos
          </div>
        </>
      )}

      {/* Order Details Modal */}
      <Envase
        hideCloseButton
        classNames={
          pantallaChica
            ? undefined
            : {
                // Se ensancha SÓLO cuando la nota está abierta. Fijo en el ancho de
                // dos, un pedido sin factura se quedaría con medio modal vacío al lado.
                base: `transition-[max-width] duration-300 ${notaAbierta ? "max-w-[80rem]" : ""}`,
              }
        }
        isDismissable={false}
        isOpen={isOpen}
        onClose={onClose}
        {...(pantallaChica
          ? // El cajón entra por la derecha y a pantalla completa: en un teléfono no
            // hay sitio para dejar la lista asomando, y verla a medias sólo estorba.
            { placement: "right" as const, size: "full" as const }
          : {
              placement: "center" as const,
              scrollBehavior: "outside" as const,
              size: "5xl" as const,
            })}
      >
        {/* Transparente y sin sombra: deja de ser la tarjeta y pasa a ser el sitio
            donde caben las dos. Cada tarjeta pone la suya. */}
        <EnvaseContenido className="bg-transparent shadow-none">
          {() => (
            <div
              className="flex w-full flex-col items-start lg:flex-row"
              data-partido="1"
            >
              {/* `data-partido`: este modal son DOS tarjetas, así que entre ellas y
                  debajo de la más corta queda hueco transparente. Ese hueco es velo con
                  otro nombre y pulsarlo tiene que cerrar — quien decide eso es
                  `esPulsacionFuera`, que busca esta marca y las de `data-tarjeta`. */}
            {/*
              DOS TARJETAS, UNA AL LADO DE LA OTRA. No una columna dentro del pedido.

              El pedido y su factura son DOS PAPELES distintos: uno lo tomó el vendedor
              y el otro lo emitió Ventra. Metida dentro de la tarjeta del pedido, al
              lado de sus productos, la factura se lee como más productos del pedido —
              que es exactamente como alguien acaba cargando el camión con la lista que
              no era.

              Por eso `ModalContent` va transparente y sin sombra: deja de ser la
              tarjeta y pasa a ser el sitio donde caben las dos. Cada una pone su
              propio fondo y su propia sombra.

              Y por eso mismo la ✕ del modal es NUESTRA (`hideCloseButton`): la de
              HeroUI se dibuja en la esquina de `ModalContent`, que ahora no se ve, y
              así fue como quedó un detalle de pedido que no había forma de cerrar.
              Escrita a mano, dentro de la cabecera del pedido, no puede desaparecer.
            */}
              <div
                className="relative z-10 flex w-full min-w-0 flex-1 flex-col rounded-large bg-content1 shadow-medium"
                data-tarjeta="pedido"
              >
              <EnvaseCabecera className="flex flex-col gap-1">
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold">
                    Pedido: {selectedOrder?.folio}
                  </h2>
                  <Chip
                    color={estadoColors[selectedOrder?.estado || "en_proceso"]}
                    size="sm"
                    variant="flat"
                  >
                    {estadoLabels[selectedOrder?.estado || "en_proceso"]}
                  </Chip>
                  {/* Y con qué factura cuadró: es lo que hay que teclear para ir a
                      buscarla en Ventra cuando el pedido y la factura no coinciden. */}
                  {selectedOrder?.facturaEstado &&
                    facturaChip[selectedOrder.facturaEstado] && (
                      <Chip
                        color={facturaChip[selectedOrder.facturaEstado].color}
                        size="sm"
                        variant="flat"
                      >
                        {facturaChip[selectedOrder.facturaEstado].texto}
                        {selectedOrder.facturaNumero
                          ? ` · ${selectedOrder.facturaNumero}`
                          : ""}
                      </Chip>
                    )}
                  </div>
                  {/* La ✕ del modal, escrita a mano y dentro de la tarjeta del pedido.
                      Cierra TODO. La de la factura, en la esquina de SU tarjeta, cierra
                      sólo la nota. Ver el comentario de las dos tarjetas, más arriba. */}
                  <Button
                    isIconOnly
                    aria-label="Cerrar el pedido"
                    radius="full"
                    size="sm"
                    variant="light"
                    onPress={onClose}
                  >
                    <span aria-hidden className="text-lg leading-none">
                      ✕
                    </span>
                  </Button>
                </div>
              </EnvaseCabecera>
              <EnvaseCuerpo>
                <div className="flex flex-col gap-4">
                  {/* Vendedor y Cliente */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-default-100">
                      <Icons.workers className="text-primary size-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-default-500">
                          Vendedor
                        </p>
                        <p className="font-semibold break-words">
                          {selectedOrder?.vendedor?.nombre || "Sin vendedor"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-default-100">
                      <Icons.client className="text-primary size-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-default-500">
                          Cliente / Local
                        </p>
                        <p className="font-semibold break-words">
                          {selectedOrder?.cliente?.nombre ||
                            selectedOrder?.encargado ||
                            "Sin cliente"}
                        </p>
                        {selectedOrder?.encargado && (
                          <p className="text-xs break-words text-default-500">
                            Encargado: {selectedOrder.encargado}
                          </p>
                        )}
                        {selectedOrder?.cliente?.codigo && (
                          <p className="text-xs text-default-500">
                            Código: {selectedOrder.cliente.codigo}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Las fechas, juntas y en su propio bloque.
                      Son tres cosas distintas que se confunden si están sueltas:
                      cuándo se hizo el pedido, para cuándo se comprometió la entrega
                      y cuándo entró en el sistema. Antes solo se veía la del medio,
                      así que no había forma de saber si un pedido de hoy era de hoy o
                      llevaba una semana esperando. */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-default-700">
                      Fechas
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <p className="mb-1 text-xs text-default-500">
                          Fecha del pedido
                        </p>
                        <p className="text-sm font-medium">
                          {comoSeLeeElDia(selectedOrder?.fecha) ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-default-500">
                          Fecha comprometida
                        </p>
                        <p className="text-sm font-medium">
                          {comoSeLeeElDia(selectedOrder?.fecha_comprometida) ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-default-500">
                          Subido al sistema
                        </p>
                        <p className="text-sm font-medium">
                          {comoSeLeeElInstante(selectedOrder?.createdAt) ?? "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Datos de entrega */}
                  {(selectedOrder?.direccion ||
                    selectedOrder?.telefono ||
                    selectedOrder?.fecha_comprometida) && (
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-default-700">
                        Datos de entrega
                      </h4>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {selectedOrder?.direccion && (
                          <div className="sm:col-span-2">
                            <p className="mb-1 text-xs text-default-500">
                              Dirección
                            </p>
                            <code className="block w-full p-2 text-sm break-all border rounded bg-default-50 select-all">
                              {selectedOrder.direccion}
                            </code>
                          </div>
                        )}
                        {selectedOrder?.telefono && (
                          <div>
                            <p className="mb-1 text-xs text-default-500">
                              Teléfono
                            </p>
                            <code className="block w-full p-2 text-sm break-all border rounded bg-default-50 select-all">
                              {selectedOrder.telefono}
                            </code>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Estado y domicilio */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-default-700">
                      Estado
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        color={
                          estadoColors[selectedOrder?.estado || "en_proceso"]
                        }
                        size="sm"
                        variant="flat"
                      >
                        {estadoLabels[selectedOrder?.estado || "en_proceso"]}
                      </Chip>

                      {selectedOrder?.pedido_cobrado != null && (
                        <Chip
                          color={
                            selectedOrder.pedido_cobrado === "parcial"
                              ? "warning"
                              : selectedOrder.pedido_cobrado === "no_pagado"
                                ? "danger"
                                : "success"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {selectedOrder.pedido_cobrado === "parcial"
                            ? "Parcialmente cobrado"
                            : selectedOrder.pedido_cobrado === "no_pagado"
                              ? "No cobrado"
                              : "Cobrado"}
                        </Chip>
                      )}
                      <Chip
                        color={
                          selectedOrder?.requiere_domicilio
                            ? "primary"
                            : "default"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {selectedOrder?.requiere_domicilio
                          ? "Requiere domicilio"
                          : "Sin domicilio"}
                      </Chip>
                    </div>

                  </div>

                  <Divider />


                  {/*
                    LA FACTURA SE LLAMA DESDE AQUÍ, Y EL BOTÓN ESTÁ SIEMPRE.

                    Siempre, cambie o no cambie: si sólo apareciera cuando hay algo raro,
                    no habría manera de mirar el papel de un pedido que salió bien — que
                    es justo lo que se pide cuando un cliente discute lo que se llevó.

                    Y cuando el pedido y la factura coinciden no se abre nada solo: lo que
                    hay que saber cabe en esta línea. Abrir un panel entero para decir
                    «todo bien» es hacer trabajar al que mira para no enterarse de nada.
                  */}
                  {selectedOrder?.facturaEstado && (
                    <div
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-large border p-3 ${
                        selectedOrder.facturaEstado === "sin_factura"
                          ? "border-default-200 bg-default-50"
                          : "border-success-200 bg-success-50"
                      }`}
                    >
                      <div className="min-w-0">
                        {selectedOrder.facturaEstado === "igual" ? (
                          <>
                            <p className="text-sm font-semibold text-success-700">
                              El pedido se mantiene contra facturación.
                            </p>
                            <p className="text-xs text-default-600">
                              Factura{" "}
                              <span className="font-mono">
                                {selectedOrder.facturaNumero ?? "—"}
                              </span>{" "}
                              · mismos productos y mismas cantidades
                            </p>
                          </>
                        ) : selectedOrder.facturaEstado === "cambiado" ? (
                          <>
                            {/* Está facturado. Que sea distinto es OTRA cosa, y se dice
                                aparte: en ámbar, como una alarma, se leía como que la
                                factura tiene algo malo, y no lo tiene. */}
                            <p className="text-sm font-semibold text-success-700">
                              Facturado, pero distinto del pedido.
                            </p>
                            <p className="text-xs text-default-600 tabular-nums">
                              Factura{" "}
                              <span className="font-mono">
                                {selectedOrder.facturaNumero ?? "—"}
                              </span>
                              {selectedOrder.lineasFactura
                                ? (() => {
                                    const r = resumenFactura(
                                      lineasDeFactura(selectedOrder.lineasFactura),
                                    );

                                    return (
                                      ` · ${r.lineas} línea${r.lineas === 1 ? "" : "s"}` +
                                      (r.conPeso > 0 ? ` · ${r.kg} kg` : "") +
                                      (r.conImporte > 0 ? ` · ${$$(r.importe)}` : "")
                                    );
                                  })()
                                : ""}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-default-600">Sin facturar todavía.</p>
                        )}
                      </div>
                      {/* Sin nota que llamar, no hay botón: un botón que no abre nada
                          es peor que ninguno. */}
                      {selectedOrder.facturaEstado === "cambiado" &&
                        selectedOrder.lineasFactura && (
                          <Button
                            color="success"
                            size="sm"
                            variant="flat"
                            onPress={() => setVerFactura((v) => !v)}
                          >
                            {notaAbierta ? "Ocultar la factura" : "Ver la factura"}
                          </Button>
                        )}
                    </div>
                  )}
                  {/* Products */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-default-700">
                      Productos ({(selectedOrder?.items.length || 0) +
                        (selectedOrder?.requiere_domicilio || selectedOrder?.costoDomicilio != null ? 1 : 0)})
                    </h4>
                    <div className="flex flex-col gap-2">
                      {selectedOrder?.items.map((item) => (
                        /* En pantalla estrecha la fila se apila: con el nombre y los
                           chips en la misma línea, un «ALIMENTOS ARROZ CAMIL 1 KG PACA
                           10U» empuja los kilos y el importe fuera de la pantalla y hay
                           que deslizar de lado para leer lo que importa. */
                        <div
                          key={item.id}
                          className="flex flex-col gap-2 rounded-lg bg-default-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Icons.productos className="size-6 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="font-medium break-words">{item.producto}</p>
                              {item.descripcion && (
                                <p className="text-xs text-default-500">
                                  {item.descripcion}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                            {item.packs != null && item.packs > 0 && (
                              <Chip size="sm" variant="flat">
                                {item.packs} formato
                                {item.packs !== 1 ? "s" : ""}
                              </Chip>
                            )}
                            <Chip size="sm" variant="flat">
                              {item.unidades} unidades
                            </Chip>
                            {/*
                              EL PESO. Sale de Ventra igual que el precio, y como el
                              precio es por unidad de venta —el formato/caja—, no por
                              unidad suelta.

                              Se pinta también cuando NO lo hay: es lo que decide si un
                              domicilio se puede cotizar, y un hueco callado se lee como
                              «pesa poco» en vez de «no lo sabemos». Los que salen sin
                              peso lo están en Ventra: hoy 72 de los 128 productos no
                              traen ninguno.
                            */}
                            {item.pesoLineaKg != null ? (
                              <Chip size="sm" variant="flat" className="tabular-nums">
                                {item.pesoLineaKg} kg
                              </Chip>
                            ) : (
                              <Chip size="sm" variant="flat" color="warning">
                                sin peso
                              </Chip>
                            )}
                            {/* El precio, que ya venía de la API y no se pintaba.
                                Sale de Ventra y es POR SUCURSAL: el mismo producto no
                                vale igual en Camagüey que en Santiago, así que no se
                                puede tener una lista única.
                                Y es por unidad de venta —el formato/caja—, no por
                                unidad suelta; por eso el importe multiplica por los
                                formatos y no por las 60 unidades. */}
                            {item.importe != null ? (
                              <div className="text-right leading-tight">
                                <p className="text-sm font-semibold tabular-nums">
                                  {$$(item.importe)}
                                </p>
                                {item.precioUnidad != null && (
                                  <p className="text-[11px] text-default-400 tabular-nums">
                                    {$$(item.precioUnidad)} c/u
                                  </p>
                                )}
                              </div>
                            ) : (
                              // Sin precio NI stock en esta sucursal = no lo hay aquí.
                              // La línea se queda porque el pedido lo pidió igual.
                              <Chip size="sm" variant="flat">
                                no hay en esta sucursal
                              </Chip>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* El domicilio es UNA LÍNEA MÁS, no un campo aparte.
                          Es un producto de servicio —así se llama en Ventra, código
                          45— y lo que se cobra por él va en el total como cualquier
                          otra línea. Tenerlo suelto en "Estado" lo dejaba fuera de la
                          cuenta y obligaba a sumarlo a mano. */}
                      {(selectedOrder?.requiere_domicilio ||
                        selectedOrder?.costoDomicilio != null) && (
                        <div className="flex items-center justify-between p-3 rounded-lg bg-primary-50 border border-primary-100">
                          <div className="flex items-center gap-3">
                            <Icons.delivery className="size-6 text-primary" />
                            <div>
                              <p className="font-medium">ENTREGA A DOMICILIO</p>
                              <p className="text-xs text-default-500">
                                Servicio
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/*
                              SI LA FACTURA CAMBIÓ, AQUÍ NO SE ENSEÑA EL PRECIO VIEJO.

                              La APK cotizó este reparto por lo que pesaba el pedido. Si
                              la factura pesa otra cosa, ese importe se calculó sobre algo
                              que no va a subir al camión: enseñarlo aquí, copiable de un
                              toque como los que sí valen, es invitar a cobrarlo.

                              En su lugar va un aviso que abre la nota de la factura, que
                              es donde el número viejo se puede enseñar al lado del peso
                              nuevo y de la diferencia — o sea, donde se entiende.
                            */}
                            {selectedOrder?.facturaEstado === "cambiado" &&
                            (selectedOrder?.costoDomicilio != null ||
                              selectedOrder?.facturaDomicilio != null) ? (
                              <Button
                                color="primary"
                                size="sm"
                                variant="flat"
                                onPress={() => setVerFactura(true)}
                              >
                                El pedido cambió · míralo en la factura
                              </Button>
                            ) : selectedOrder?.costoDomicilio != null ? (
                              /* Copiable de un toque: este número se teclea en otro
                                 sitio para cobrar, y volver a escribirlo a mano es la
                                 forma más fácil de equivocarse en el importe. Va el
                                 número pelado, sin símbolo de moneda ni miles, que es
                                 lo que se pega en una caja de texto. */
                              <Snippet
                                hideSymbol
                                classNames={{ pre: "text-base font-semibold" }}
                                size="sm"
                                variant="flat"
                              >
                                {importeCrudo(
                                  selectedOrder.costoDomicilio,
                                  moneda,
                                  tasa,
                                )}
                              </Snippet>
                            ) : (
                              <Chip color="warning" size="sm" variant="flat">
                                Sin calcular todavía
                              </Chip>
                            )}
                          </div>
                        </div>
                      )}

                    </div>

                    {/*
                      LO QUE DICE LA FACTURA, al lado.

                      El pedido de arriba es el que tomó el vendedor y no se toca. Esto es
                      lo que se llevó el cliente de verdad. Hubo una versión que reescribía
                      el pedido con la factura y salió mal: un cliente con varios pedidos
                      el mismo día acababa con la misma factura copiada en todos.
                    */}
                  </div>
                </div>
              </EnvaseCuerpo>
              <EnvasePie className="flex-col items-stretch gap-3">
                {/* EL TOTAL, fuera de la lista de productos.
                    Estaba dentro, como una línea más, y ahí se lee como si fuera otro
                    artículo del pedido — con su borde y su fila, igual que el arroz.
                    El total no es un producto: es el resultado. Va aparte y encima de
                    lo que se copia, que es lo último que se mira antes de facturar. */}
                <div className="flex w-full items-center justify-between rounded-lg border-2 border-default-300 bg-default-100 p-3">
                  <div>
                    <p className="text-base font-semibold">Total del pedido</p>
                    {/* No es "falta un dato": es que ese producto NO ESTÁ en esta
                        sucursal ahora mismo. Ventra lo deja sin precio ni stock por si
                        vuelve a haberlo, y decirlo como una carencia nuestra manda a
                        buscar un fallo donde no lo hay. */}
                    {(selectedOrder?.lineasSinPrecio ?? 0) > 0 && (
                      <p className="text-xs text-default-500">
                        {selectedOrder?.lineasSinPrecio} producto
                        {selectedOrder?.lineasSinPrecio !== 1 ? "s" : ""} sin existencia
                        en esta sucursal, no {selectedOrder?.lineasSinPrecio !== 1 ? "cuentan" : "cuenta"} en el total
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {selectedOrder?.total != null ? (
                      <p className="text-2xl font-bold tabular-nums">
                        {$$(selectedOrder.total)}
                      </p>
                    ) : (
                      <Chip size="sm" variant="flat">
                        ningún producto disponible aquí
                      </Chip>
                    )}
                    {/*
                      EL PESO TOTAL, debajo del importe.

                      Es lo que decide si esto cabe en un camión y lo que cuesta llevarlo
                      a domicilio, así que se mira tanto como el dinero. Se dice cuántas
                      líneas no lo traen: un peso total que se queda corto porque faltan
                      tres productos engaña más que no enseñar ninguno.
                    */}
                    {pesoDelPedido != null && (
                      <p className="text-xs text-default-500 tabular-nums">
                        {pesoDelPedido} kg
                        {lineasSinPeso > 0 && (
                          <span className="text-warning-600">
                            {" "}· {lineasSinPeso} sin peso
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="w-full p-3 border rounded-lg bg-warning-50 border-warning-200">
                  <p className="mb-2 text-xs text-warning-700">
                    Copia este texto manualmente:
                  </p>
                  <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                    {`P-${selectedOrder?.folio}; V-${selectedOrder?.vendedor?.nombre || "Sin vendedor"}; C-${selectedOrder?.cliente?.codigo || selectedOrder?.cliente?.nombre || "Sin cliente"};`}
                  </code>
                </div>
                <div className="flex justify-between w-full gap-2">
                  <div>
                    {canDeleteOrders && (
                      <Button
                        color="danger"
                        startContent={<Icons.trash className="size-5" />}
                        variant="flat"
                        onPress={() =>
                          selectedOrder && handleAskConfirmDelete(selectedOrder)
                        }
                      >
                        Eliminar Pedido
                      </Button>
                    )}
                  </div>
                  <div>
                    {/* UN botón que cambia con el estado, no tres apilados.
                        En proceso se completa; completado o expirado se devuelve a
                        en proceso. Es la misma casilla de la pantalla y la misma
                        posición siempre: no hay que buscar dónde apareció el botón
                        de hoy. */}
                    {puedeCompletar && selectedOrder && (
                      selectedOrder.estado === "en_proceso" ? (
                        <Button
                          color="primary"
                          startContent={<Icons.check className="size-5" />}
                          onPress={() => handleAskConfirmComplete(selectedOrder)}
                        >
                          Completar Pedido
                        </Button>
                      ) : (
                        <Button
                          color="warning"
                          startContent={<Icons.back className="size-5" />}
                          variant="flat"
                          onPress={() => handleAskConfirmReabrir(selectedOrder)}
                        >
                          {selectedOrder.estado === "expirada"
                            ? "Volver a En proceso"
                            : "Reabrir Pedido"}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </EnvasePie>
              </div>
                    {/*
                      LA FACTURA, EN SU PROPIA HOJA AL LADO DEL PEDIDO.

                      Al lado y no debajo: la pregunta es comparar, y dos listas una
                      encima de otra obligan a subir y bajar para responderla.

                      Del mismo alto que el pedido —`items-stretch` en la reja— y SIN
                      scroll propio: la hoja crece con lo que trae y el que se desliza es
                      el modal, como con cualquier otra cosa larga. Tuvo un `max-h` con su
                      barra dentro y quedaba un scroll metido en otro, que se ve fatal y
                      deja media factura fuera para quien no lo encuentra.

                      Y estuvo FUERA de la tarjeta, sobre el velo del modal: ahí no hay
                      margen, está la página de detrás, el texto encima no se lee y la ✕
                      del modal se quedaba debajo, así que no había forma de cerrarlo. En
                      un modal esa metáfora no cabe.
                    */}
                    {pantallaChica ? null : notaFactura}
            </div>
          )}
        </EnvaseContenido>
      </Envase>

      {/*
        EN MÓVIL, LA FACTURA VA EN SU PROPIO CAJÓN.

        Al lado no cabe, y colgada debajo del pedido se lee como si fuera más pedido:
        sigue justo detrás de la lista de productos, con el mismo aspecto, y quien
        baja deslizando no distingue dónde acaba uno y empieza la otra. Son dos
        papeles distintos y tienen que abrirse por separado.

        Entra desde abajo, que es de donde se espera algo que se consulta y se cierra
        —el pedido ya ocupa la entrada por la derecha— y así los dos gestos no chocan.
      */}

      {/*
        LOS FILTROS, EN UN CAJÓN.

        Eran tres desplegables seguidos en la barra y ya no cabían: entre buscar,
        producto, domicilio, vendedor y las dos fechas, los campos salían partidos.

        Y de uno en uno no se puede preguntar lo que se pregunta de verdad —«qué hay en
        proceso O expirado y además devuelto»—, porque un desplegable deja escoger uno.
        Aquí se marcan los que sean, de los tres grupos, y se aplican de una vez.

        Con buscador porque son varias decenas de combinaciones y bajar por la lista
        para encontrar «facturado pero distinto» es más lento que teclear «fact».
      */}
      <Drawer isOpen={filtrosAbiertos} placement="right" size="sm" onClose={cerrarFiltros}>
        <DrawerContent>
          <DrawerHeader className="flex-col items-start gap-0">
            <p className="text-lg font-semibold">Filtros</p>
            <p className="text-xs font-normal text-default-500">
              Se aplican todos juntos, en una sola consulta.
            </p>
          </DrawerHeader>
          <DrawerBody className="gap-4">
                <Input
                  isClearable
                  placeholder="Buscar un estado…"
                  size="sm"
                  startContent={<Icons.search className="size-4 text-default-400" />}
                  value={buscaFiltro}
                  variant="bordered"
                  onValueChange={setBuscaFiltro}
                />
                {/*
                  Cada grupo se pliega. Abiertos de entrada —para ver de un vistazo qué
                  hay marcado sin abrir nada—, pero con seis grupos y una veintena de
                  opciones el cajón se hace largo, y quien sólo va a tocar la facturación
                  no tiene por qué bajar por todo lo demás.

                  `selectionMode="multiple"` para que cerrar uno no abra otro: son
                  independientes, no pestañas.
                */}
                <Accordion
                  className="px-0"
                  defaultExpandedKeys={[
                    ...gruposDeEstado.map((g) => g.titulo),
                    "Producto",
                    "Domicilio",
                    "Vendedor",
                  ]}
                  itemClasses={{
                    trigger: "py-2",
                    title: "text-xs font-semibold uppercase tracking-wide text-default-500",
                    content: "pt-0 pb-2",
                  }}
                  selectionMode="multiple"
                  showDivider={false}
                  variant="light"
                >
                  {[
                    ...gruposDeEstado
                      .filter((g) => g.opciones.length > 0)
                      .map((g) => (
                      <AccordionItem
                        key={g.titulo}
                        aria-label={g.titulo}
                        // Cuántos hay marcados en ESTE grupo, para verlo con el grupo
                        // cerrado. Sin esto, plegar es esconder lo que está filtrando.
                        startContent={
                          g.valor.length > 0 ? (
                            <Chip color="primary" size="sm" variant="flat">
                              {g.valor.length}
                            </Chip>
                          ) : null
                        }
                        title={g.titulo}
                      >
                        <CheckboxGroup size="sm" value={g.valor} onValueChange={g.poner}>
                          {g.opciones.map((o) => (
                            <Checkbox key={o.value} value={o.value}>
                              {o.label}
                            </Checkbox>
                          ))}
                        </CheckboxGroup>
                        </AccordionItem>
                      )),
                    <AccordionItem key="Producto" aria-label="Producto" title="Producto">
                      {/* Filtrar por producto: "enséñame los pedidos que llevan ESTO". Es lo
                      que se necesita cuando falta mercancía y hay que avisar a quien la
                      pidió. La lista sale de las líneas reales de esta sucursal, así que
                      no hay opciones que devuelvan cero. */}
                      {/* Autocompletado y no un desplegable a secas: son cientos de productos.
                      Bajar por una lista de esas es inservible —hay que escribir "arroz" y
                      que salgan los arroces—, y además el desplegable dejaba el primero
                      medio tapado por el borde del campo. */}
                      <Autocomplete
                      allowsCustomValue={false}
                      className="w-full"
                      // Cada opción son DOS líneas (producto y categoría). Sin altura ni
                      // separación se montan una encima de otra y no se distingue dónde
                      // acaba una y empieza la siguiente. El `py` de la lista es para que la
                      // primera no nazca pegada al borde, que salía cortada.
                      // `h-auto` es lo que arregla el solapamiento: la opción traía altura
                      // fija del tema, así que un nombre que ocupa dos líneas se salía de su
                      // caja y se montaba encima de la siguiente.
                      listboxProps={{
                      itemClasses: {
                      base: "py-2 h-auto data-[hover=true]:bg-default-100",
                      },
                      }}
                      popoverProps={{ classNames: { content: "py-1" } }}
                      defaultItems={productos.map((nombre) => ({
                      nombre,
                      ...partirProducto(nombre),
                      }))}
                      placeholder="Todos · escribe para buscar"
                      selectedKey={productoFilter || null}
                      variant="bordered"
                      onSelectionChange={(k) => setProductoFilter(k ? String(k) : "")}
                      >
                      {(item: { nombre: string; categoria: string; producto: string }) => (
                      // `textValue` es por lo que se busca al teclear: el nombre ENTERO, para
                      // que quien escriba "alimentos" o "arroz" lo encuentre igual.
                      <AutocompleteItem key={item.nombre} textValue={item.nombre}>
                      {/* Una sola línea: el nombre y, a la derecha, su categoría en
                      pequeño. Apiladas se montaban una encima de otra en cuanto el
                      nombre no cabía de un renglón — y casi ninguno cabe. */}
                      <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm truncate">{item.producto}</span>
                      {item.categoria && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-default-400">
                      {item.categoria}
                      </span>
                      )}
                      </div>
                      </AutocompleteItem>
                      )}
                      </Autocomplete>
                    </AccordionItem>,
                    <AccordionItem key="Domicilio" aria-label="Domicilio" title="Domicilio">
                      <Select
                      className="w-full"
                      selectedKeys={[borrDomicilio]}
                      startContent={
                      <Icons.delivery className="size-5 text-default-400" />
                      }
                      variant="bordered"
                      onChange={(e) => setBorrDomicilio(e.target.value || "todos")}
                      >
                      {domicilioOptions.map((option) => (
                      <SelectItem key={option.value}>{option.label}</SelectItem>
                      ))}
                      </Select>
                    </AccordionItem>,
                    <AccordionItem key="Vendedor" aria-label="Vendedor" title="Vendedor">
                      <VendedorSelect
                      className="w-full"
                      value={borrVendedor}
                      vendedores={vendedores}
                      onChange={setBorrVendedor}
                      />
                    </AccordionItem>,
                  ]}
                </Accordion>
                {gruposDeEstado.every((g) => g.opciones.length === 0) && (
                  <p className="py-2 text-center text-xs text-default-400">
                    Ningún estado se llama así.
                  </p>
                )}
              <Switch
                isSelected={borrArchivados}
                size="sm"
                onValueChange={setBorrArchivados}
              >
                <span className="text-sm text-default-600">
                  Incluir archivados en la búsqueda
                </span>
              </Switch>

          </DrawerBody>
          <DrawerFooter className="flex-col gap-2">
            <Button
              className="w-full"
              color="primary"
              isDisabled={borrMarcados === 0 && marcados === 0}
              onPress={aplicarFiltros}
            >
              {borrMarcados === 0
                ? "Quitar los filtros"
                : `Aplicar ${borrMarcados} filtro${borrMarcados === 1 ? "" : "s"}`}
            </Button>
            {borrMarcados > 0 && (
              <Button
                className="w-full"
                variant="light"
                onPress={() => {
                  setBorrEstados([]);
                  setBorrRepartos([]);
                  setBorrFacturas([]);
                  setBuscaFiltro("");
                }}
              >
                Desmarcar todo
              </Button>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {pantallaChica && (
        <Drawer
          isOpen={isOpen && !!notaAbierta}
          placement="bottom"
          size="4xl"
          onClose={() => setVerFactura(false)}
        >
          <DrawerContent className="bg-transparent shadow-none">
            <DrawerBody className="px-3 pb-4">{notaFactura}</DrawerBody>
          </DrawerContent>
        </Drawer>
      )}

      {/* Confirmar que se devuelve a "en proceso" */}
      <Modal isOpen={isReabrirConfirmOpen} placement="center" onClose={onReabrirConfirmClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-warning">Volver a En proceso</span>
          </ModalHeader>
          <ModalBody>
            <p>
              <strong>Folio:</strong> {orderToReabrir?.folio}
            </p>
            {orderToReabrir?.estado === "expirada" ? (
              <p className="text-sm text-default-600">
                Este pedido sale como expirado porque su fecha comprometida ya pasó
                {orderToReabrir?.fecha_comprometida
                  ? ` (${comoSeLeeElDia(orderToReabrir.fecha_comprometida)})`
                  : ""}
                . Para que vuelva a estar en proceso hay que quitarle esa fecha, y eso
                es lo que va a pasar. Si lo que quieres es darle más plazo, mejor
                cámbiale la fecha comprometida.
              </p>
            ) : (
              <p className="text-sm text-default-600">
                Vuelve a la lista como en proceso. Si estaba archivado, se desarchiva.
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onReabrirConfirmClose}>
              Cancelar
            </Button>
            <Button
              color="warning"
              onPress={() => {
                if (orderToReabrir) handleReabrirOrder(orderToReabrir.id);
                onReabrirConfirmClose();
                setOrderToReabrir(null);
              }}
            >
              Sí, volver a En proceso
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal de confirmación para completar pedido */}
      <Modal isOpen={isConfirmOpen} placement="center" onClose={onConfirmClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-primary">✓ Confirmar Acción</span>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-default-700">
                ¿Estás seguro que deseas completar este pedido?
              </p>
              {orderToComplete && (
                <div className="p-3 rounded-lg bg-default-100">
                  <p className="text-sm">
                    <strong>Folio:</strong> {orderToComplete.folio}
                  </p>
                  <p className="text-sm">
                    <strong>Cliente:</strong>{" "}
                    {orderToComplete.cliente?.nombre || "N/A"}
                  </p>
                  <p className="text-sm">
                    <strong>Vendedor:</strong>{" "}
                    {orderToComplete.vendedor?.nombre || "N/A"}
                  </p>
                </div>
              )}
              <p className="text-xs text-warning-600">
                Esta acción marcará el pedido como completado.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="flat" onPress={onConfirmClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              onPress={() =>
                orderToComplete && handleCompletarOrder(orderToComplete.id)
              }
            >
              Sí, Completar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal de confirmación para eliminar pedido */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        placement="center"
        onClose={onDeleteConfirmClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-danger">⚠ Eliminar Pedido</span>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-default-700">
                ¿Estás seguro que deseas eliminar este pedido?
              </p>
              {orderToDelete && (
                <div className="p-3 rounded-lg bg-danger-50 border border-danger-200">
                  <p className="text-sm">
                    <strong>Folio:</strong> {orderToDelete.folio}
                  </p>
                  <p className="text-sm">
                    <strong>Cliente:</strong>{" "}
                    {orderToDelete.cliente?.nombre || "N/A"}
                  </p>
                  <p className="text-sm">
                    <strong>Vendedor:</strong>{" "}
                    {orderToDelete.vendedor?.nombre || "N/A"}
                  </p>
                </div>
              )}
              <p className="text-xs text-danger-600">
                Esta acción no se puede deshacer. El pedido y todos sus items
                serán eliminados permanentemente.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="default"
              variant="flat"
              onPress={onDeleteConfirmClose}
            >
              Cancelar
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={() =>
                orderToDelete && handleDeleteOrder(orderToDelete.id)
              }
            >
              Sí, Eliminar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
};
