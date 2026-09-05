/**
 * Partir un rango de fechas en tramos de un mes.
 *
 * Existe porque **Ventra no pagina**: sólo acepta `limit`, y `ventasDeSucursal` pide
 * 5.000 líneas como mucho. Las Tunas hace unas 4.000 en treinta días, así que pedir dos
 * meses de un tirón se corta por el final SIN DECIRLO — la consulta responde 200, los
 * datos parecen bien, y faltan las facturas de la cola. El cotejo entonces marca «sin
 * factura» pedidos que sí la tienen, y esos pedidos se quedan fuera de la ruta sin que
 * nadie sepa por qué.
 *
 * Va en su propio fichero, sin importar nada, para poder probarlo: cargarlo desde el
 * script arrastraría Prisma y una conexión a la base sólo para comprobar unas fechas.
 */
export function* tramosMensuales(desde: Date, hasta: Date): Generator<[Date, Date]> {
  let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);

  while (cur <= hasta) {
    const sig = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const ini = cur < desde ? desde : cur;
    /**
     * El fin del tramo es el último INSTANTE del mes, no el día 1 del siguiente.
     *
     * Con el día 1 se pediría un día de más y el último del mes entraría en dos tramos.
     * Duplicar no rompe nada —el cotejo es idempotente— pero desplaza el recuento y
     * hace pensar que hay más facturas de las que hay.
     */
    const fin = new Date(Math.min(sig.getTime() - 1, hasta.getTime()));

    yield [ini, fin];
    cur = sig;
  }
}
