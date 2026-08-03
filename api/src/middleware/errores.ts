import { NextFunction, Request, Response } from 'express';

/**
 * Vigilancia de errores 5xx.
 *
 * Hasta ahora, si un endpoint reventaba en producción NADIE se enteraba: cada ruta
 * hacía su `console.error` y ahí quedaba, mezclado con el resto del log. Un fallo
 * podía estar rompiéndole el trabajo a una sucursal durante días.
 *
 * Aquí se hacen dos cosas:
 *  - toda respuesta 5xx (y toda excepción no capturada de una ruta) escribe UNA
 *    línea con formato fijo, `PROCOVAR-5XX | ...`, fácil de encontrar en el log;
 *  - se lleva la cuenta en memoria y se expone en /salud, para poder mirar de un
 *    vistazo si el api está sano.
 *
 * El aviso por correo lo manda el servidor: hay un vigilante que lee el log del
 * contenedor y busca esa marca (ver procovar-vigilar-errores en el VPS). Así el
 * api no necesita saber nada de SMTP ni bloquearse mandando correos.
 */

const MAX_RECIENTES = 20;

interface ErrorRegistrado {
  cuando: string;
  metodo: string;
  ruta: string;
  estado: number;
  mensaje: string;
}

const recientes: ErrorRegistrado[] = [];
let total5xx = 0;

const arrancado = Date.now();

function registrar(e: ErrorRegistrado) {
  total5xx++;
  recientes.unshift(e);
  if (recientes.length > MAX_RECIENTES) recientes.length = MAX_RECIENTES;

  // Una sola línea, sin saltos: así el vigilante del servidor la puede contar y
  // mandarla por correo tal cual, sin tener que reconstruir nada.
  console.error(
    `PROCOVAR-5XX | ${e.estado} | ${e.metodo} ${e.ruta} | ${e.mensaje.replace(/\s+/g, ' ').slice(0, 300)}`,
  );
}

/** Se pone ANTES de los routers: observa el estado con el que se cierra cada respuesta. */
export function observarRespuestas(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    // Los que pasan por el manejador de abajo ya se registraron: no duplicar.
    if ((res as unknown as { _yaRegistrado?: boolean })._yaRegistrado) return;
    registrar({
      cuando: new Date().toISOString(),
      metodo: req.method,
      ruta: req.originalUrl.split('?')[0],
      estado: res.statusCode,
      mensaje: 'respuesta 5xx',
    });
  });
  next();
}

/** Manejador final. Se pone DESPUÉS de todos los routers (4 argumentos: Express lo exige). */
export function manejarErrores(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const mensaje = err instanceof Error ? err.message : String(err);

  (res as unknown as { _yaRegistrado?: boolean })._yaRegistrado = true;
  registrar({
    cuando: new Date().toISOString(),
    metodo: req.method,
    ruta: req.originalUrl.split('?')[0],
    estado: 500,
    mensaje,
  });
  if (err instanceof Error && err.stack) console.error(err.stack);

  // Si ya se empezó a escribir la respuesta (streams SSE), no se puede tocar.
  if (res.headersSent) return;
  // Al cliente NUNCA se le manda el detalle interno: solo el aviso.
  res.status(500).json({ error: 'Error interno del servidor' });
}

/** Datos para GET /salud. */
export function estadoSalud() {
  return {
    ok: true,
    arrancadoHace: Math.round((Date.now() - arrancado) / 1000),
    errores5xx: total5xx,
    ultimos: recientes,
  };
}
