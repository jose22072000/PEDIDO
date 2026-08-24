// La sucursal de ESTA instalación. Cada PEDIDO corre en su sucursal y escribe sólo
// sobre lo suyo: es lo que impide que un webhook mal apuntado meta el costo de un
// domicilio de Camagüey en un pedido de Santiago con el mismo folio.
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(__dirname, '../../config.json');

export function readConfiguredSucursalId(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as { sucursalId?: string | null };
    return parsed.sucursalId?.trim() || null;
  } catch {
    return null;
  }
}
