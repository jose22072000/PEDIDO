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
  
  // Generate code as "nombre.apellido" in lowercase
  const generateSellerCode = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]}.${parts[1]}`.toLowerCase();
    }
    return name.toLowerCase();
  };
  
  return {
    seller: {
      name: vendedorName,
      code: generateSellerCode(vendedorName),
    },
    client: {
      nombre: clienteNombre,
      // Accept multiple possible CSV headers for the client code
      codigo:
        csvRecord.codigo_cliente || csvRecord.codigoCliente || csvRecord.clienteId || csvRecord.cliente_id || null,
      zona: csvRecord.zona || csvRecord.Zona || null,
    },
    order: {
      folio: folio,
      direccion: csvRecord.direccion || csvRecord.Direccion || null,
      encargado: encargadoNombre || null,
      telefono: csvRecord.telefono || csvRecord.Telefono || null,
      fecha: csvRecord.fecha ? new Date(csvRecord.fecha) : new Date(),
      fecha_comprometida: csvRecord.fecha_comprometida 
        ? new Date(csvRecord.fecha_comprometida) 
        : null,
    },
    item: {
      producto: producto,
      unidades: Number(csvRecord.unidades || csvRecord.Unidades || 0),
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
