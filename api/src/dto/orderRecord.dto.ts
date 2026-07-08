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
  unidades: number;
  packs?: number | null;
  descripcion?: string | null;
}

// DTO for order data
export interface OrderDto {
  folio: string;
  direccion?: string | null;
  encargado?: string | null;
  telefono?: string | null;
  fecha: Date;
  fecha_comprometida?: Date | null;
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

// Mapper function to transform CSV records to structured DTO
export function mapCsvToOrderRecord(csvRecord: any): OrderRecordDto {
  const vendedorName = (csvRecord.vendedor || csvRecord.Vendedor || '').toUpperCase();
  const clienteNombre = (csvRecord.cliente || csvRecord.Cliente || '').toUpperCase();
  const encargadoNombre = (csvRecord.encargado || csvRecord.Encargado || '').toUpperCase();
  const folio = (csvRecord.folio || csvRecord.Folio || '').toUpperCase();
  const producto = (csvRecord.producto || csvRecord.Producto || '').toUpperCase();
  
  // Código del vendedor = "nombre.primer_apellido" (es la CLAVE ÚNICA GLOBAL con la
  // que el import ubica al vendedor, ya que el CSV no trae la sucursal).
  //
  // Los nombres cubanos son: nombre [segundo nombre] apellido1 [apellido2].
  // Tomar las 2 primeras palabras agarraría el SEGUNDO NOMBRE, no el apellido:
  //   "GLENDA MELISA BLANCO ÁLVAREZ" -> glenda.melisa  ✗   (y colisiona fácil)
  // El primer apellido es la penúltima palabra cuando hay 2 apellidos, y la última
  // cuando solo hay uno. Esto reproduce los nombres de archivo del Drive:
  //   "GLENDA MELISA BLANCO ÁLVAREZ" -> glenda.blanco   ✓
  //   "DIANGO DAVID GOLA BLANCO"     -> diango.gola     ✓
  //   "ALEXANDER PADRON"             -> alexander.padron ✓
  //
  // Además se quitan las TILDES: los archivos que exporta Parranda vienen sin ellas
  // ("alexander.padron.pedidos.csv"), y ese nombre no lo podemos cambiar.
  // Además de las tildes se quitan los caracteres de CONTROL (C0/C1). Un nombre que
  // llegó con el encoding roto ("PADRÃN") arrastra un byte invisible (U+0093) que se
  // colaba en el código y lo volvía imposible de escribir o buscar.
  const sinTildes = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

  const generateSellerCode = (name: string): string => {
    const parts = sinTildes(name.trim()).split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      return `${parts[0]}.${parts[parts.length - 2]}`.toLowerCase();
    }
    if (parts.length === 2) {
      return `${parts[0]}.${parts[1]}`.toLowerCase();
    }
    return sinTildes(name).toLowerCase();
  };
  
  return {
    seller: {
      name: vendedorName,
      code: generateSellerCode(vendedorName),
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
      // Add T12:00:00 to prevent timezone issues when parsing date-only strings
      fecha: csvRecord.fecha ? new Date(csvRecord.fecha + 'T12:00:00') : new Date(),
      fecha_comprometida: csvRecord.fecha_comprometida 
        ? new Date(csvRecord.fecha_comprometida + 'T12:00:00') 
        : null,
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
      unidades: Number(csvRecord.unidades || csvRecord.Unidades || 0),
      packs: csvRecord.packs || csvRecord.Packs ? Number(csvRecord.packs || csvRecord.Packs) : null,
      descripcion: csvRecord.descripcion || csvRecord.Descripcion || null,
    },
  };
}

// Batch mapper for multiple records with folio suffix logic
export function mapCsvRecords(csvRecords: any[]): OrderRecordDto[] {
  // First, map all records
  const mappedRecords = csvRecords.map(mapCsvToOrderRecord);
  
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
