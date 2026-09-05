/**
 * Cliente del Data Warehouse (Ventra). SOLO LECTURA.
 *
 * Aquí no se escribe NADA en Ventra: es el sistema del que vive la empresa y esta
 * aplicación no tiene por qué poder tocarlo. Solo hay GETs, y así se queda.
 *
 * Alcanzable únicamente por la VPN WireGuard. Sin VPN esto falla, y falla en silencio
 * a propósito: PEDIDO tiene que seguir funcionando aunque el almacén no conteste — lo
 * que pasa es que los precios se quedan con la última foto buena en vez de vaciarse.
 *
 * El endpoint bueno es `/products/weights?database=<sucursal>`. La documentación lo
 * dice con todas las letras: "Precio y existencias VARÍAN POR SUCURSAL, por eso se
 * recomienda pasar database para una sucursal específica". Sin ese parámetro solo
 * llegan los pesos, que es lo que delivery venía usando y por lo que nadie sabía que
 * el precio estaba ahí.
 */

const BASE = process.env.VENTRA_API_URL || 'http://10.188.2.2:3001/api/external-api';
const TOKEN = process.env.VENTRA_API_TOKEN || process.env.WAREHOUSE_API_TOKEN || '';

/** Una fila del catálogo, ya por sucursal. */
export interface ProductoVentra {
  sku: string | null;
  name: string | null;
  category: string | null;
  unit: string | null;
  weightKg: number | null;
  /** Existencias en ESA sucursal. */
  stock: number | null;
  /** Precio en ESA sucursal. */
  price: number | null;
  isActive?: boolean | null;
}

async function leer<T>(ruta: string): Promise<T> {
  if (!TOKEN) throw new Error('VENTRA_API_TOKEN no configurado');
  const url = `${BASE}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  // 30 s: es una consulta a un ERP por VPN, no una API de al lado. Pero con tope: sin
  // él, un almacén colgado deja el sondeo esperando para siempre y no vuelve a correr.
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`Ventra ${res.status} en ${ruta}: ${cuerpo.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Saca de una fila el primer campo que exista de una lista de nombres posibles.
 *
 * Ventra es un ERP y sus columnas no siempre se llaman igual (`price`, `unitPrice`,
 * `precio`…). Buscar por varios nombres es más robusto que fijar uno y que el día que
 * cambien la etiqueta se queden todos los precios en cero sin que nadie lo note.
 */
function numero(fila: Record<string, unknown>, ...nombres: string[]): number | null {
  for (const n of nombres) {
    const v = fila[n];
    if (v == null || v === '') continue;
    const x = Number(v);
    if (!Number.isNaN(x)) return x;
  }
  return null;
}

function texto(fila: Record<string, unknown>, ...nombres: string[]): string | null {
  for (const n of nombres) {
    const v = fila[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export interface BaseVentra {
  /** El slug que hay que mandar en `?database=`. Ej: "camaguey", "granma". */
  database: string;
  /** Cómo llama Ventra a esa sucursal. Ej: "CAMAGUEY", "BAYAMO". */
  branchName: string;
  connected: boolean;
}

/**
 * Las bases (sucursales) que Ventra tiene configuradas.
 *
 * Hay que preguntárselas, NO deducirlas del nombre de nuestras sucursales. Los slugs
 * no se parecen a lo que uno supondría:
 *
 *   granma      → BAYAMO           (nuestra sucursal se llama Granma, la suya Bayamo)
 *   holguinmoa  → HOLGUIN          (y Moa tiene además su propia base, `moa`)
 *   sspiritus   → SANCTI SPIRITUS  (abreviado, y sin acentos)
 *   tunas       → LAS TUNAS        (sin el "las")
 *
 * Adivinar el slug es equivocarse en cuatro de diez, y equivocarse aquí significa
 * dejar una sucursal entera sin precios sin que nadie lo note.
 */
export async function databases(): Promise<BaseVentra[]> {
  const d = await leer<unknown>('/axis/databases');
  const filas = (Array.isArray(d)
    ? d
    : ((d as Record<string, unknown>)?.items as unknown[]) ||
      ((d as Record<string, unknown>)?.data as unknown[]) ||
      []) as Record<string, unknown>[];

  return filas
    .map((f) => ({
      database: texto(f, 'database') || '',
      branchName: texto(f, 'branchName', 'name') || '',
      connected: (f.connected as boolean) ?? true,
    }))
    .filter((b) => b.database);
}

/**
 * El catálogo de UNA sucursal: peso, existencias y precio.
 *
 * `database` es obligatorio aquí aunque la API lo acepte vacío: sin él, el precio y el
 * stock que devuelve no son de ninguna sucursal en concreto, y guardarlos como si lo
 * fueran es peor que no tenerlos.
 */
export async function catalogoDeSucursal(database: string): Promise<ProductoVentra[]> {
  const d = await leer<unknown>(`/products/weights?database=${encodeURIComponent(database)}`);
  const filas = (Array.isArray(d)
    ? d
    : ((d as Record<string, unknown>)?.items as unknown[]) ||
      ((d as Record<string, unknown>)?.data as unknown[]) ||
      []) as Record<string, unknown>[];

  return filas.map((f) => ({
    sku: texto(f, 'sku', 'productCode', 'code'),
    name: texto(f, 'name', 'productName', 'descripcion'),
    category: texto(f, 'category', 'categoria'),
    unit: texto(f, 'unit', 'unidad'),
    weightKg: numero(f, 'weightKg', 'weight', 'pesoKg'),
    // Los nombres REALES que devuelve Ventra son `existencias` y `precioUsd`. Los
    // demás quedan como red por si un día renombran la columna: es un ERP, y perder
    // todos los precios en silencio por un nombre cambiado es el fallo que no se ve.
    stock: numero(f, 'existencias', 'stock', 'quantity', 'existencia', 'onHand'),
    price: numero(f, 'precioUsd', 'price', 'unitPrice', 'salePrice', 'precio'),
    isActive: (f.isActive as boolean) ?? null,
  }));
}

/**
 * Una línea de FACTURA de Ventra: lo que de verdad se vendió.
 *
 * `operNumber` es el número de la factura —varias líneas lo comparten— y `cantidad` va en
 * unidades de venta (el formato), igual que el precio y el peso del catálogo.
 */
export interface LineaVentaVentra {
  id: string;
  fecha: string;
  operNumber: string;
  clienteCodigo: string | null;
  clienteNombre: string;
  productoCodigo: string | null;
  productoNombre: string;
  cantidad: number;
  precioUsd: number | null;
  /**
   * La NOTA de la factura. Es donde va el folio del pedido.
   *
   * Es el único dato que ata una factura a UN pedido concreto. Cruzar por nombre de
   * cliente no vale: un cliente pide dos días seguidos, y las dos facturas caben en los
   * dos pedidos — así acabó la misma factura pegada a dos pedidos distintos.
   */
  nota: string | null;
}

/**
 * Lo facturado en UNA sucursal, entre dos fechas.
 *
 * `database` es obligatorio: sin él Ventra devuelve el consolidado de todas y no hay
 * forma de saber de qué sucursal es cada factura, que es justo lo que hace falta para
 * cotejarla contra el pedido correcto.
 */
export async function ventasDeSucursal(
  database: string,
  desde: string,
  hasta: string,
  tope = 5000,
): Promise<LineaVentaVentra[]> {
  const d = await leer<unknown>(
    `/axis/sales?database=${encodeURIComponent(database)}&from=${desde}&to=${hasta}&limit=${tope}`,
  );
  const cuerpo = d as Record<string, unknown>;
  const filas = (Array.isArray(d)
    ? d
    : (cuerpo?.rows as unknown[]) || (cuerpo?.items as unknown[]) || (cuerpo?.data as unknown[]) || []) as Record<string, unknown>[];

  /**
   * SI VUELVE EXACTAMENTE EL TOPE, Ventra CORTÓ — y no lo dice en ninguna parte.
   *
   * Es el fallo que no se ve: la consulta responde 200, con datos que parecen bien, y
   * faltan las facturas del final. El cotejo entonces marca «sin factura» pedidos que sí
   * la tienen, y esos pedidos se quedan fuera de la ruta sin que nadie sepa por qué.
   *
   * Aquí no se puede arreglar —Ventra no pagina, sólo acepta `limit`—, así que se grita.
   * Quien pida un rango que no cabe tiene que trocearlo: es lo que hace
   * `scripts/recuperar-cotejo`, mes a mes.
   */
  if (filas.length >= tope) {
    console.warn(
      `[ventra] TRUNCADO: ${database} ${desde}..${hasta} devolvió ${filas.length} líneas, ` +
        'que es el tope. FALTAN facturas. Hay que pedir el rango en tramos más cortos.',
    );
  }

  return filas
    .map((f) => ({
      id: String(f.id ?? ''),
      fecha: texto(f, 'date', 'fecha') ?? '',
      operNumber: String(f.operNumber ?? f.numero ?? ''),
      clienteCodigo: texto(f, 'customerCode', 'clienteCodigo'),
      clienteNombre: texto(f, 'customerName', 'clienteNombre') ?? '',
      productoCodigo: texto(f, 'productCode', 'productoCodigo'),
      productoNombre: texto(f, 'productName', 'productoNombre') ?? '',
      cantidad: numero(f, 'quantity', 'cantidad') ?? 0,
      precioUsd: numero(f, 'priceOut', 'precioUsd'),
      // Varios nombres posibles: es un ERP y no siempre llama igual a la misma columna.
      nota: texto(f, 'note', 'nota', 'observaciones', 'observacion', 'comment', 'comentario', 'description'),
    }))
    .filter((l) => l.id && l.productoNombre);
}
