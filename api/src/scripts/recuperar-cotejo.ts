/**
 * Vuelve a cotejar pedidos VIEJOS, para rellenar lo que les falta.
 *
 * # Por qué hace falta
 *
 * El cotejo mira tres días atrás. Los pedidos anteriores a que se guardaran las
 * unidades, los kilos y los importes de cada línea tienen la factura a medias —producto,
 * código y formatos, nada más— y la ventana normal ya no los alcanza nunca. En la
 * pantalla salen con guiones y sin total para siempre: la factura está ahí, pero no dice
 * cuánto.
 *
 * Esto los vuelve a pasar por el mismo cotejo, con la misma lógica, y los deja completos.
 *
 * # Por qué MES A MES y no de un tirón
 *
 * Ventra no pagina: sólo acepta `limit`, y `ventasDeSucursal` pide 5.000 líneas como
 * mucho. Las Tunas hace unas 4.000 en treinta días, así que un tramo de cuarenta días
 * **se cortaría por el final sin decirlo** — la consulta responde 200, los datos parecen
 * bien, y faltan facturas. El cotejo entonces marcaría «sin factura» pedidos que sí la
 * tienen, y esos pedidos se quedan fuera de la ruta sin que nadie sepa por qué.
 *
 * Troceando por meses ningún tramo se acerca al tope. Y si aun así alguno lo alcanzara,
 * `ventasDeSucursal` lo grita en el registro: buscar «TRUNCADO» después de correr esto.
 *
 * # Cómo se usa
 *
 *   node dist/scripts/recuperar-cotejo.js --desde=2026-08-01
 *   node dist/scripts/recuperar-cotejo.js --desde=2026-08-01 --seco
 *
 * Se lanza A MANO y de noche: cada mes de ventana es una vuelta más a Ventra por la VPN,
 * por cada sucursal, y con las sucursales trabajando eso le quita ancho a lo que sí es
 * urgente.
 *
 * Es idempotente: escribe lo mismo que escribiría el cotejo normal, así que repetirlo no
 * duplica nada y cortarlo por la mitad no deja nada a medias — se vuelve a lanzar y ya.
 */
import { cotejarUnaVez } from '../lib/cotejoFacturacion';
import { tramosMensuales } from '../lib/tramosMensuales';

function argumento(nombre: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));

  return p ? p.slice(nombre.length + 3) : null;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

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

  const hasta = new Date();
  const tramos = [...tramosMensuales(desde, hasta)];

  console.log(`[recuperar] desde ${crudo} hasta hoy — ${tramos.length} tramos de un mes.`);
  for (const [i, f] of tramos) console.log(`[recuperar]   ${dia(i)} .. ${dia(f)}`);

  if (process.argv.includes('--seco')) {
    console.log('[recuperar] --seco: no se ha tocado nada. Quita la bandera para lanzarlo.');
    return;
  }

  const empezado = Date.now();
  let pedidos = 0;
  let igual = 0;
  let cambiado = 0;
  let sinFactura = 0;

  for (const [ini, fin] of tramos) {
    const rs = await cotejarUnaVez({ desde: ini, hasta: fin });
    const ok = rs.filter((r) => !r.error);
    const suma = (f: (r: (typeof rs)[number]) => number) => ok.reduce((a, r) => a + f(r), 0);

    pedidos += suma((r) => r.cotejados);
    igual += suma((r) => r.igual);
    cambiado += suma((r) => r.cambiado);
    sinFactura += suma((r) => r.sinFactura);

    console.log(
      `[recuperar] ${dia(ini)}..${dia(fin)}: ${suma((r) => r.cotejados)} pedidos · ` +
        `${suma((r) => r.igual)} igual, ${suma((r) => r.cambiado)} cambiados, ` +
        `${suma((r) => r.sinFactura)} sin factura`,
    );

    // Las sucursales que fallan se dicen UNA A UNA y con su motivo: en una recuperación
    // de varios meses, «fallaron dos» sin decir cuáles obliga a repetirlo entero.
    for (const r of rs.filter((x) => x.error)) {
      console.error(`[recuperar]   ${dia(ini)} ${r.sucursal}: ${r.error}`);
    }
  }

  console.log(
    `[recuperar] TERMINADO · ${pedidos} pedidos · ${igual} igual, ${cambiado} cambiados, ` +
      `${sinFactura} sin factura · ${((Date.now() - empezado) / 1000).toFixed(0)} s`,
  );
  console.log('[recuperar] busca «TRUNCADO» arriba: si sale, ese tramo se cortó y faltan facturas.');
}

principal()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[recuperar] falló:', e);
    process.exit(1);
  });
