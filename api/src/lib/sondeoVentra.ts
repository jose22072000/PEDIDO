/**
 * Traer de Ventra el catálogo de cada sucursal, cada cierto tiempo.
 *
 * Un sondeo y no un webhook porque Ventra no avisa: es un ERP detrás de una VPN, no
 * manda nada hacia fuera. Preguntar cada rato es lo único que hay, y encima sobrevive
 * a los cortes de VPN sin que nadie tenga que reintentar a mano.
 *
 * Cada pasada es idempotente: escribe por (sucursal, sku), así que correrla dos veces
 * seguidas deja lo mismo.
 *
 * NO BORRA lo que deja de venir. Si Ventra contesta media lista —por un corte a mitad
 * de descarga, por ejemplo— borrar lo que falta dejaría media sucursal sin precios. Lo
 * que no llega se queda con su `traidoAt` viejo, que es exactamente la señal de "esto
 * está rancio" sin haber perdido el dato.
 */
import prisma from '../prismaClient';
import { catalogoDeSucursal } from './ventra';

/** Cada cuánto se pregunta. El catálogo cambia poco; 30 min es de sobra. */
const CADA_MS = Number(process.env.VENTRA_SONDEO_MS || 30 * 60 * 1000);

export interface ResultadoSondeo {
  sucursal: string;
  database: string;
  leidos: number;
  escritos: number;
  conPrecio: number;
  conStock: number;
  error?: string;
}

/**
 * La base de Ventra que le toca a cada sucursal.
 *
 * Ventra nombra sus bases por el nombre de la sucursal ("CAMAGUEY", "SANTIAGO"), y
 * aquí la sucursal tiene nombre y código. Se cruza por el NOMBRE normalizado, que es
 * lo que coincide; el código no ("CAM" ≠ "CAMAGUEY").
 */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export async function sondearUnaVez(): Promise<ResultadoSondeo[]> {
  const sucursales = await prisma.sucursal.findMany({ select: { id: true, nombre: true, codigo: true } });
  const salida: ResultadoSondeo[] = [];

  for (const suc of sucursales) {
    // La base se llama como la sucursal. Se manda el nombre normalizado, que es lo que
    // Ventra usa en `database`.
    const database = normalizar(suc.nombre);
    const r: ResultadoSondeo = {
      sucursal: suc.nombre, database, leidos: 0, escritos: 0, conPrecio: 0, conStock: 0,
    };

    try {
      const filas = await catalogoDeSucursal(database);
      r.leidos = filas.length;

      for (const f of filas) {
        if (!f.sku || !f.name) continue;
        if (f.price != null) r.conPrecio++;
        if (f.stock != null) r.conStock++;

        await prisma.productoSucursal.upsert({
          where: { sucursalId_sku: { sucursalId: suc.id, sku: f.sku } },
          update: {
            nombre: f.name, categoria: f.category, unidad: f.unit,
            pesoKg: f.weightKg, stock: f.stock, precio: f.price,
            activo: f.isActive ?? true, traidoAt: new Date(),
          },
          create: {
            sucursalId: suc.id, sku: f.sku, nombre: f.name, categoria: f.category,
            unidad: f.unit, pesoKg: f.weightKg, stock: f.stock, precio: f.price,
            activo: f.isActive ?? true,
          },
        });
        r.escritos++;
      }
    } catch (e) {
      // Una sucursal que falla no para las demás: puede ser que su base de Axis esté
      // caída y las otras nueve estén bien.
      r.error = (e as Error).message;
    }

    salida.push(r);
  }

  return salida;
}

export function arrancarSondeoVentra(): void {
  if (!process.env.VENTRA_API_TOKEN && !process.env.WAREHOUSE_API_TOKEN) {
    console.log('[ventra] sin token: no se sondea el catálogo (los precios se quedan como estén)');
    return;
  }

  const correr = () => {
    sondearUnaVez()
      .then((rs) => {
        const ok = rs.filter((r) => !r.error);
        const mal = rs.filter((r) => r.error);
        console.log(
          `[ventra] catálogo: ${ok.length} sucursales al día ` +
            `(${ok.reduce((a, r) => a + r.escritos, 0)} productos, ` +
            `${ok.reduce((a, r) => a + r.conPrecio, 0)} con precio)` +
            (mal.length ? ` · fallaron ${mal.map((r) => r.sucursal).join(', ')}` : ''),
        );
      })
      .catch((e) => console.error('[ventra] sondeo falló:', (e as Error).message));
  };

  // Un minuto de margen al arrancar: durante el despliegue la VPN puede no estar lista
  // todavía, y un fallo en el primer segundo no dice nada.
  setTimeout(correr, 60_000);
  setInterval(correr, CADA_MS);
  console.log(`[ventra] sondeo del catálogo cada ${Math.round(CADA_MS / 60000)} min`);
}
