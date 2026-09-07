import { Router } from 'express';

import prisma from '../prismaClient';
import { estadoDeFactura, HORA_CORTE, type EstadoFactura } from '../lib/corteFacturacion';
import { leerUltimaPasada } from '../lib/cotejoEstado';
import { parsearFechaConsulta } from '../lib/fechaConsulta';
import { getRequesterContext, resolveSucursalFilter } from '../lib/sucursalContext';

/**
 * La vista del SINCRONIZADOR de facturación: qué se cotejó, qué cuadró y qué no.
 *
 * # Por qué hace falta una pantalla para esto
 *
 * «Completado» y «facturado» son cosas distintas y hasta ahora no había forma de ver la
 * diferencia. El 07/09/2026, de los 148 pedidos del día anterior, sólo 10 tenían factura
 * en Ventra. Los otros 138 podían estar en tres situaciones que desde la lista de pedidos
 * se ven exactamente igual:
 *
 *   1. Todavía no se ha facturado. El día 6 fue domingo: La Habana facturó cero líneas ese
 *      día y treinta y ocho el viernes. Se factura al día siguiente, y eso es normal.
 *   2. Se facturó y NO se pegó el folio en la nota. El folio lo copia y lo pega una
 *      persona al facturar en Ventra, así que aquí es donde se pierde de verdad.
 *   3. Se pegó mal —un dígito de menos, el sufijo comido—.
 *
 * Sin separarlas, el que mira ve trescientos «sin facturar» y deja de mirarlos. Con el
 * corte de las 18:30, los de hoy salen como «buscando» y sólo los de días cerrados como
 * «no apareció», que son los que de verdad hay que perseguir.
 *
 * # Y por qué NO le pregunta nada a Ventra
 *
 * Todo lo que enseña sale de nuestra base y de Redis. El cotejo ya corre en el worker cada
 * diez minutos y deja ahí el resultado de su última pasada; la pantalla lo lee. Si la
 * vista sondeara Ventra, abrirla ocho veces serían ochenta consultas por la VPN, y el
 * trabajo de fondo pasaría a depender de que alguien tenga una pestaña abierta.
 */
const router = Router();

/**
 * Esto no es para el Operador, igual que los informes: es una pantalla de control, y quien
 * sube pedidos no tiene por qué ver el estado de la facturación de la sucursal entera.
 * Se comprueba una vez para todo el router, para que una ruta nueva nazca protegida.
 */
router.use((req, res, next) => {
  if (!getRequesterContext(req).puedeImportarYReportar) {
    return res.status(403).json({ error: 'Tu usuario no puede ver el estado de la facturación.' });
  }

  return next();
});

interface FilaDia {
  sucursalId: string | null;
  sucursal: string;
  dia: string;
  total: number;
  facturado: number;
  cambiado: number;
  buscando: number;
  noAparecio: number;
  sinCotejar: number;
}

/** El día en Cuba de una fecha, que es como se agrupa: el día del pedido, no el UTC. */
const diaEnCuba = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/**
 * El resumen: por sucursal y día, cuántos pedidos hay en cada situación.
 *
 * Por defecto, los últimos siete días. Se acota siempre por arriba y por abajo: sin tope,
 * la consulta se traería el histórico entero para pintar una tabla de una semana.
 */
router.get('/resumen', async (req, res) => {
  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const hastaP = parsearFechaConsulta(req.query.hasta, 'hasta', true);

  if (hastaP.error) return res.status(400).json({ error: hastaP.error });

  const hasta = hastaP.fecha ?? new Date();
  const desdeP = parsearFechaConsulta(req.query.desde, 'desde');

  if (desdeP.error) return res.status(400).json({ error: desdeP.error });

  const desde = desdeP.fecha ?? new Date(hasta.getTime() - 7 * 86400000);

  const pedidos = await prisma.pedido.findMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      ...(sucursalId ? { sucursalId } : {}),
    },
    select: {
      id: true,
      folio: true,
      fecha: true,
      estado: true,
      facturaEstado: true,
      facturaNumero: true,
      sucursalId: true,
      sucursal: { select: { nombre: true } },
      vendedor: { select: { nombre: true } },
      cliente: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'desc' }, { folio: 'asc' }],
  });

  const ahora = new Date();
  const porDia = new Map<string, FilaDia>();
  /**
   * Los que hay que perseguir, con el folio a la vista.
   *
   * Sólo los `no_aparecio`: los que están «buscando» no son un problema todavía y meterlos
   * aquí llenaría la lista de ruido justo el día que más se mira.
   */
  const aPerseguir: Array<{
    id: string;
    folio: string;
    fecha: Date;
    sucursal: string;
    vendedor: string | null;
    cliente: string | null;
    estado: string | null;
  }> = [];

  for (const p of pedidos) {
    const dia = diaEnCuba(p.fecha);
    const clave = `${p.sucursalId ?? '-'}|${dia}`;
    const fila = porDia.get(clave) ?? {
      sucursalId: p.sucursalId,
      sucursal: p.sucursal?.nombre ?? 'sin sucursal',
      dia,
      total: 0,
      facturado: 0,
      cambiado: 0,
      buscando: 0,
      noAparecio: 0,
      sinCotejar: 0,
    };

    const est: EstadoFactura = estadoDeFactura(p.facturaEstado, p.fecha, ahora);

    fila.total++;
    if (est === 'facturado') fila.facturado++;
    else if (est === 'cambiado') fila.cambiado++;
    else if (est === 'buscando') fila.buscando++;
    else if (est === 'no_aparecio') fila.noAparecio++;
    else fila.sinCotejar++;

    porDia.set(clave, fila);

    if (est === 'no_aparecio') {
      aPerseguir.push({
        id: p.id,
        folio: p.folio,
        fecha: p.fecha,
        sucursal: p.sucursal?.nombre ?? 'sin sucursal',
        vendedor: p.vendedor?.nombre ?? null,
        cliente: p.cliente?.nombre ?? null,
        estado: p.estado,
      });
    }
  }

  const dias = [...porDia.values()].sort(
    (a, b) => b.dia.localeCompare(a.dia) || a.sucursal.localeCompare(b.sucursal),
  );

  return res.json({
    desde,
    hasta,
    horaCorte: HORA_CORTE,
    dias,
    // Con tope: si un día entero se quedó sin facturar son cientos, y mandarlos todos por
    // el cable para pintar una tabla que nadie va a leer entera no ayuda a nadie.
    aPerseguir: aPerseguir.slice(0, 300),
    aPerseguirTotal: aPerseguir.length,
    ultimaPasada: await leerUltimaPasada(),
  });
});

export default router;
