import { codigoDesdeNombre } from '../lib/nombreVendedor';
import { convencionDeFechas, leerFecha, type Convencion } from '../lib/fechaDelCsv';

// DTO for seller data
export interface SellerDto {
  name: string;
  code: string;
}

// DTO for client data
export interface ClientDto {
  nombre: string;
  codigo?: string | null;
  zona?: string | null;
}

// DTO for order item data
export interface OrderItemDto {
  producto: string;
  codigo?: string | null;
  unidades: number;
  packs?: number | null;
  descripcion?: string | null;
  /** Hectolitros de esta linea. Lo manda Parranda desde el 06/08/2026. */
  hl?: number | null;
  /** Importe de esta linea. Lo manda Parranda desde el 06/08/2026. */
  precio_linea?: number | null;
}

// DTO for order data
export interface OrderDto {
  folio: string;
  direccion?: string | null;
  encargado?: string | null;
  telefono?: string | null;
  fecha: Date;
  /** Por qué no se pudo leer la fecha. Con esto la fila se rechaza DICIENDO el motivo. */
  fechaError?: string | null;
  fecha_comprometida?: Date | null;
  fechaComprometidaError?: string | null;
  pedido_cobrado?: string | null;
  requiere_domicilio?: boolean | null;
}

// Main DTO that contains all related entities
export interface OrderRecordDto {
  seller: SellerDto;
  client: ClientDto;
  order: OrderDto;
  item: OrderItemDto;
}

/** Numero de una celda que puede venir vacia. Vacio o ilegible = null, no 0. */
function numeroOpcional(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Mapper function to transform CSV records to structured DTO
export function mapCsvToOrderRecord(csvRecord: any, convencion: Convencion = 'iso'): OrderRecordDto {
  const vendedorName = (csvRecord.vendedor || csvRecord.Vendedor || '').toUpperCase();
  const clienteNombre = (csvRecord.cliente || csvRecord.Cliente || '').toUpperCase();
  const encargadoNombre = (csvRecord.encargado || csvRecord.Encargado || '').toUpperCase();
  const folio = (csvRecord.folio || csvRecord.Folio || '').toUpperCase();
  const producto = (csvRecord.producto || csvRecord.Producto || '').toUpperCase();
  
  // Codigo del vendedor = "nombre.primer_apellido" (es la CLAVE UNICA GLOBAL con
  // la que el import ubica al vendedor, ya que el CSV no trae la sucursal).
  //
  // La regla vive en `lib/nombreVendedor` porque el alta manual desde la
  // aplicacion tiene que generar EXACTAMENTE el mismo codigo. Aqui estaba
  // copiada, con un comentario avisando de que habia que cambiar los dos sitios a
  // la vez: ese aviso era justo la senal de que sobraba tenerla dos veces.
  return {
    seller: {
      name: vendedorName,
      code: codigoDesdeNombre(vendedorName),
    },
    client: {
      nombre: clienteNombre,
      // Accept multiple possible CSV headers for the client code.
      // Only treat it as valid if it is purely numeric; otherwise use null.
      codigo: (() => {
        const raw = csvRecord.codigo_cliente || csvRecord.codigoCliente || csvRecord.clienteId || csvRecord.cliente_id;
        if (!raw) return null;
        const str = String(raw).trim();
        return /^\d+$/.test(str) ? str : null;
      })(),
      zona: csvRecord.zona || csvRecord.Zona || null,
    },
    order: {
      folio: folio,
      direccion: csvRecord.direccion || csvRecord.Direccion || null,
      encargado: encargadoNombre || null,
      telefono: csvRecord.telefono || csvRecord.Telefono || null,
      /**
       * Las fechas, en el formato que traiga el archivo. Ver `lib/fechaDelCsv`.
       *
       * Antes era `new Date(texto + 'T12:00:00')`, que sólo entiende ISO: en cuanto
       * alguien abría el CSV en Excel y lo guardaba, las fechas salían como «9/1/2026»,
       * daban `Invalid Date` y la fila reventaba al guardarse — con la pantalla diciendo
       * «subido exitosamente» igual.
       */
      fecha: leerFecha(csvRecord.fecha, convencion).fecha ?? new Date(),
      fechaError: leerFecha(csvRecord.fecha, convencion).error ?? null,
      fecha_comprometida: leerFecha(csvRecord.fecha_comprometida, convencion).fecha,
      fechaComprometidaError: leerFecha(csvRecord.fecha_comprometida, convencion).error ?? null,
      pedido_cobrado: (() => {
        const raw = csvRecord.pedido_cobrado || csvRecord.pedidoCobrado || null;
        if (!raw || String(raw).trim() === '') return null;
        return String(raw).trim().toLowerCase();
      })(),
      requiere_domicilio: (() => {
        const raw = csvRecord.requiere_domicilio || csvRecord.requiereDomicilio;
        if (raw === undefined || raw === null || String(raw).trim() === '') return null;
        return String(raw).trim().toLowerCase() === 'true';
      })(),
    },
    item: {
      producto: producto,
      // El codigo del producto tal cual lo manda Parranda (ALIM0011...). Venia
      // en el CSV y se estaba tirando: la columna del modelo existia vacia.
      codigo: (() => {
        const raw = csvRecord.codigo_producto || csvRecord.codigoProducto || csvRecord.codigo;
        const str = raw == null ? '' : String(raw).trim();
        return str === '' ? null : str;
      })(),
      unidades: Number(csvRecord.unidades || csvRecord.Unidades || 0),
      packs: csvRecord.packs || csvRecord.Packs ? Number(csvRecord.packs || csvRecord.Packs) : null,
      descripcion: csvRecord.descripcion || csvRecord.Descripcion || null,
      // hl y precio_linea: los añadio Parranda el 06/08/2026. Vienen VACIOS en
      // las lineas que no son de bebida (el arroz no tiene hectolitros), asi que
      // una celda en blanco es null y NO cero: cero significaria "medido y da 0",
      // y eso al sumar miente. Numero mal formado tambien es null, por lo mismo.
      hl: numeroOpcional(csvRecord.hl ?? csvRecord.HL),
      precio_linea: numeroOpcional(csvRecord.precio_linea ?? csvRecord.precioLinea),
    },
  };
}

// Batch mapper for multiple records with folio suffix logic
export function mapCsvRecords(
  csvRecords: any[],
  /** Lo que ya está guardado, para no moverle el folio a nadie. Ver `asignarSufijos`. */
  yaAsignados: FoliosYaAsignados = new Map(),
): OrderRecordDto[] {
  /**
   * Cómo lee las fechas ESTE archivo, decidido con todas a la vez.
   *
   * Basta con que una sola fila traiga un día mayor que 12 para saber leer las demás. Si
   * ninguna lo aclara, las ambiguas se rechazan con su motivo en vez de adivinar: elegir
   * mal no da error, archiva el pedido con meses de diferencia y nadie lo encuentra.
   */
  const convencion = convencionDeFechas([
    ...csvRecords.map((r) => r?.fecha),
    ...csvRecords.map((r) => r?.fecha_comprometida),
  ]);

  // First, map all records
  const mappedRecords = csvRecords.map((r) => mapCsvToOrderRecord(r, convencion));
  
  return asignarSufijos(mappedRecords, yaAsignados);
}

/** Sin tildes, sin signos y en mayúsculas: para reconocer al mismo cliente escrito a mano. */
export function claveDeCliente(nombre: string): string {
  return (nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** La clave del grupo: un folio es de UN vendedor. Dos vendedores pueden repetirlo. */
export function claveDeGrupo(r: OrderRecordDto): string {
  return `${(r.seller.code || r.seller.name).toUpperCase().trim()}|${r.order.folio}`;
}

/**
 * Los folios que YA existen en la base para un folio base, y de qué cliente es cada uno.
 *
 * Mapa `claveDeGrupo` -> (clave del cliente -> folio exacto que ya tiene).
 */
export type FoliosYaAsignados = Map<string, Map<string, string>>;

/**
 * Repartir los clientes que comparten folio, SIN moverle el suyo a ninguno.
 *
 * # Qué es esto
 *
 * Un vendedor usa **un folio para toda su jornada** y mete debajo a todos sus clientes.
 * En La Habana, `PRM25-260901-1808` son seis pedidos de seis clientes distintos. Aquí se
 * separan: el folio base para uno, y `-1`, `-2`… para los demás.
 *
 * No es un caso raro: desde el 1 de agosto hay 1.677 folios así, y en Santiago son 1.038
 * de 3.008 pedidos.
 *
 * # El fallo que esto corrige
 *
 * El sufijo se asignaba por el ORDEN en que los clientes aparecían en el CSV. Y ese orden
 * no es estable: los archivos llegan por tandas y se reimportan. Al reimportar con los
 * clientes en otro orden, TCP ANA pasaba de `-3` a `-4` **y se quedaba con la factura de
 * otro** — porque el operador copia el folio de aquí a la nota de Ventra, y esa nota es
 * lo único que ata una factura a un pedido.
 *
 * Un pedido con la factura de otro parece correcto y nadie lo mira. Ése es el error caro.
 *
 * # Cómo se arregla
 *
 * El folio de un cliente se decide UNA vez y no se le vuelve a tocar. Si ya tiene uno en
 * la base, se conserva tal cual. Sólo los clientes NUEVOS reciben número, y toman el
 * primero libre.
 *
 * Y los nuevos se ordenan por nombre antes de repartir, para que reimportar el mismo
 * archivo con las filas en otro orden dé exactamente el mismo resultado.
 */
export function asignarSufijos(
  registros: OrderRecordDto[],
  yaAsignados: FoliosYaAsignados = new Map(),
): OrderRecordDto[] {
  const grupos = new Map<string, OrderRecordDto[]>();

  for (const r of registros) {
    const clave = claveDeGrupo(r);

    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(r);
  }

  const salida: OrderRecordDto[] = [];

  for (const [claveGrupo, delGrupo] of grupos) {
    const base = delGrupo[0].order.folio;
    const conocidos = yaAsignados.get(claveGrupo) ?? new Map<string, string>();

    // Los clientes de este folio EN ESTE ARCHIVO, cada uno con sus filas.
    const porCliente = new Map<string, OrderRecordDto[]>();

    for (const r of delGrupo) {
      const c = claveDeCliente(r.client.nombre);

      if (!porCliente.has(c)) porCliente.set(c, []);
      porCliente.get(c)!.push(r);
    }

    /**
     * Un solo cliente y ninguno guardado antes: el folio se queda como vino.
     *
     * Es el caso corriente —la inmensa mayoría de los folios son de un cliente— y no
     * tiene por qué llevar un `-1` que no significa nada.
     */
    if (porCliente.size === 1 && conocidos.size === 0) {
      salida.push(...delGrupo);
      continue;
    }

    // Lo que ya está ocupado: lo de la base, y lo que se vaya dando aquí.
    const ocupados = new Set<string>(conocidos.values());
    const asignado = new Map<string, string>();
    const nuevos: string[] = [];

    for (const c of porCliente.keys()) {
      const suyo = conocidos.get(c);

      if (suyo) asignado.set(c, suyo);
      else nuevos.push(c);
    }

    // Por nombre, no por orden de aparición: así el mismo archivo da siempre lo mismo.
    nuevos.sort();

    let n = 0;

    for (const c of nuevos) {
      let folio = ocupados.has(base) ? `${base}-${++n}` : base;

      // Y si ese número también estaba dado, se sigue buscando. Puede pasar cuando la
      // base tiene huecos porque un pedido se borró.
      while (ocupados.has(folio)) folio = `${base}-${++n}`;
      ocupados.add(folio);
      asignado.set(c, folio);
    }

    for (const [c, filas] of porCliente) {
      const folio = asignado.get(c) as string;

      for (const r of filas) salida.push({ ...r, order: { ...r.order, folio } });
    }
  }

  return salida;
}
