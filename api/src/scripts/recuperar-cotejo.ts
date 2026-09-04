/**
 * Vuelve a cotejar pedidos VIEJOS, para rellenar lo que les falta.
 *
 * # Por qué hace falta
 *
 * El cotejo mira tres días atrás. Los pedidos anteriores a que se guardaran las
 * unidades, los kilos y los importes de cada línea tienen la factura a medias —producto,
 * código y formatos, nada más— y la ventana normal ya no los alcanza nunca. En la
 * pantalla salen con guiones y sin total: la factura está ahí, pero no dice cuánto.
 *
 * Esto los vuelve a pasar por el mismo cotejo, con la misma lógica, y los deja completos.
 *
 * # Cómo se usa
 *
 *   node dist/scripts/recuperar-cotejo.js --desde=2026-08-01
 *   node dist/scripts/recuperar-cotejo.js --desde=2026-08-01 --seco
 *
 * Se lanza A MANO y de noche. Cada día de ventana es una vuelta más a Ventra por la VPN,
 * por sucursal: pedir cuarenta días de las ocho es un repaso serio, y hacerlo con las
 * sucursales trabajando le quita ancho a lo que sí es urgente.
 *
 * Es idempotente: escribe lo mismo que escribiría el cotejo normal, así que repetirlo no
 * duplica nada y cortarlo por la mitad no deja nada a medias.
 */
import { cotejarUnaVez } from '../lib/cotejoFacturacion';

function argumento(nombre: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));

  return p ? p.slice(nombre.length + 3) : null;
}

async function principal(): Promise<void> {
  const crudo = argumento('desde');

  if (!crudo) {
    console.error('Falta --desde=AAAA-MM-DD. Ejemplo: --desde=2026-08-01');
    process.exit(1);
  }

  const desde = new Date(`${crudo}T00:00:00`);

  if (Number.isNaN(desde.getTime())) {
    console.error(`No entiendo la fecha "${crudo}". Se espera AAAA-MM-DD.`);
    process.exit(1);
  }

  const dias = Math.ceil((Date.now() - desde.getTime()) / 86400000);

  console.log(`[recuperar] desde ${crudo} — ${dias} días, las ocho sucursales.`);
  console.log('[recuperar] esto le pide a Ventra ese rango entero, sucursal por sucursal.');

  if (process.argv.includes('--seco')) {
    console.log('[recuperar] --seco: no se hace nada. Quita la bandera para lanzarlo.');
    return;
  }

  const empezado = Date.now();
  const rs = await cotejarUnaVez({ desde });
  const suma = (f: (r: (typeof rs)[number]) => number) =>
    rs.filter((r) => !r.error).reduce((a, r) => a + f(r), 0);
  const mal = rs.filter((r) => r.error);

  console.log(
    `[recuperar] ${suma((r) => r.cotejados)} pedidos · ` +
      `${suma((r) => r.igual)} igual, ${suma((r) => r.cambiado)} cambiados, ` +
      `${suma((r) => r.sinFactura)} sin factura · ` +
      `${((Date.now() - empezado) / 1000).toFixed(0)} s`,
  );

  // Las sucursales que fallaron se dicen UNA A UNA, con su motivo: en una recuperación
  // de cuarenta días, «fallaron dos» sin decir cuáles obliga a repetirlo entero.
  for (const r of mal) console.error(`[recuperar] ${r.sucursal}: ${r.error}`);
}

principal()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[recuperar] falló:', e);
    process.exit(1);
  });
