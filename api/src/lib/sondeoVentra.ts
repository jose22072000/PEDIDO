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
import { catalogoDeSucursal, databases } from './ventra';

/** Cada cuánto se pregunta. El catálogo cambia poco; 30 min es de sobra. */
/**
 * Cada 12 horas.
 *
 * Los precios de Ventra cambian, pero no cada media hora. Sondear tan seguido eran 48
 * pasadas al día contra la API del almacén —diez sucursales cada una— por un dato que
 * se mueve un par de veces al día como mucho. Y el almacén se llega por VPN: es un
 * enlace que conviene no cargar por gusto.
 *
 * Doce horas deja el precio con medio día de antigüedad como peor caso, y eso es lo que
 * hay: el precio con el que se cotiza sale de aquí, no de un cálculo en vivo.
 */
const CADA_MS = Number(process.env.VENTRA_SONDEO_MS || 12 * 60 * 60 * 1000);

export interface ResultadoSondeo {
  sucursal: string;
  database: string;
  leidos: number;
  escritos: number;
  /** Filas que venían igual que la última vez y no se tocaron. */
  sinCambio: number;
  conPrecio: number;
  conStock: number;
  error?: string;
}

/**
 * La base de Ventra que le toca a cada sucursal.
 *
 * Se le PREGUNTA a Ventra en cada pasada en vez de deducirlo: sus slugs no se parecen
 * a lo que uno supondría —`granma` es BAYAMO, `sspiritus` es Sancti Spíritus, `tunas`
 * es Las Tunas— y adivinar falla en cuatro de diez. Fallar aquí deja una sucursal
 * entera sin precios sin que salte nada.
 *
 * Se cruza por el nombre normalizado contra las DOS cosas que da Ventra: el slug y su
 * nombre de sucursal. Así "Granma" encuentra la base `granma` aunque allí se llame
 * BAYAMO, y "Camagüey" encuentra `camaguey` pese al acento.
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
  const bases = await databases();
  const salida: ResultadoSondeo[] = [];

  for (const suc of sucursales) {
    const clave = normalizar(suc.nombre);
    const base = bases.find(
      (b) => normalizar(b.database) === clave || normalizar(b.branchName) === clave,
    );

    const r: ResultadoSondeo = {
      sucursal: suc.nombre, database: base?.database || '', leidos: 0, escritos: 0, sinCambio: 0,
      conPrecio: 0, conStock: 0,
    };

    if (!base) {
      // Se dice cuál es y con qué se intentó: una sucursal que no cruza es una
      // sucursal sin precios, y callarlo es dejarla así para siempre.
      r.error = `sin base en Ventra que cuadre con "${suc.nombre}" (bases: ${bases.map((b) => b.database).join(', ')})`;
      salida.push(r);
      continue;
    }
    if (!base.connected) {
      r.error = `la base ${base.database} figura desconectada en Ventra`;
      salida.push(r);
      continue;
    }

    const database = base.database;
    try {
      const filas = await catalogoDeSucursal(database);
      r.leidos = filas.length;

      // Lo que ya tenemos de esta sucursal, para comparar antes de escribir. Una sola
      // consulta contra las 127 escrituras que se ahorra.
      const yaEstaban = new Map(
        (await prisma.productoSucursal.findMany({
          where: { sucursalId: suc.id },
          select: { sku: true, nombre: true, precio: true, stock: true, pesoKg: true },
        })).map((x) => [x.sku, x]),
      );

      for (const f of filas) {
        if (!f.sku || !f.name) continue;
        if (f.price != null) r.conPrecio++;
        if (f.stock != null) r.conStock++;


        // Sólo se escribe lo que CAMBIÓ.
        //
        // El catálogo son 127 filas por sucursal y de una pasada a otra cambia un puñado de
        // precios. Reescribirlas todas eran 1.270 escrituras cada vez para actualizar cinco
        // —y con `@updatedAt`, además, dejaba a todas con fecha de ahora mismo, así que no
        // había forma de saber cuál se había movido de verdad.
        const previo = yaEstaban.get(f.sku);
        const igual =
          previo &&
          previo.nombre === f.name &&
          previo.precio === (f.price ?? null) &&
          previo.stock === (f.stock ?? null) &&
          previo.pesoKg === (f.weightKg ?? null);
        if (igual) { r.sinCambio++; continue; }
        r.escritos++;

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
  console.log(`[ventra] sondeo del catálogo cada ${(CADA_MS / 3600000).toFixed(1)} h`);
}
