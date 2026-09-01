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
export function mapCsvRecords(csvRecords: any[]): OrderRecordDto[] {
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
  
  // Group records by vendedor + folio to detect multiple clients
  const folioGroups = new Map<string, OrderRecordDto[]>();
  
  mappedRecords.forEach(record => {
    const key = `${record.seller.name}|${record.order.folio}`;
    if (!folioGroups.has(key)) {
      folioGroups.set(key, []);
    }
    folioGroups.get(key)!.push(record);
  });
  
  // Process each group to detect multiple clients and add suffixes
  const processedRecords: OrderRecordDto[] = [];
  
  folioGroups.forEach((records, key) => {
    // Get unique clients in this folio group
    const clientMap = new Map<string, OrderRecordDto[]>();
    
    records.forEach(record => {
      const clientKey = record.client.nombre;
      if (!clientMap.has(clientKey)) {
        clientMap.set(clientKey, []);
      }
      clientMap.get(clientKey)!.push(record);
    });
    
    // If only one client, no suffix needed
    if (clientMap.size === 1) {
      processedRecords.push(...records);
    } else {
      // Multiple clients with same folio - add suffixes
      let clientIndex = 1;
      clientMap.forEach((clientRecords) => {
        clientRecords.forEach(record => {
          processedRecords.push({
            ...record,
            order: {
              ...record.order,
              folio: `${record.order.folio}-${clientIndex}`,
            },
          });
        });
        clientIndex++;
      });
    }
  });
  
  return processedRecords;
}
