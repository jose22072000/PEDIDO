import { NextFunction, Request, Response } from 'express';

import { resolveServiceKey } from '../lib/apiKey';
import { getRequesterContext } from '../lib/sucursalContext';

/**
 * Protege la importación masiva (`POST /orders/bulk`).
 *
 * Este endpoint estaba ABIERTO a internet: un POST sin ninguna cabecera devolvía
 * 202 y creaba pedidos, clientes y vendedores. Se quedó así porque el ingester
 * (n8n) lo llama sin autenticación, y exigirla de golpe habría parado la ingesta
 * de las siete sucursales.
 *
 * La distinción que lo resuelve: n8n llama al api DIRECTAMENTE entre contenedores
 * (`http://pedido-api-…:8400`), mientras que todo lo que viene de internet pasa
 * por Traefik, que siempre pone `x-forwarded-for`. El puerto 8400 no está
 * publicado en el host, así que desde fuera NO hay forma de esquivar el proxy —
 * y una cabecera falsa no ayuda a nadie: su presencia solo AÑADE requisitos.
 *
 * Resultado: desde internet hace falta identificarse (sesión de usuario o
 * `x-api-key`); desde la red interna se sigue aceptando como hasta ahora.
 *
 * Lo siguiente es emitirle una API key a n8n y exigirla siempre, y entonces esto
 * se puede simplificar a `serviceAuth`.
 */
export const ingestaAuth = async (req: Request, res: Response, next: NextFunction) => {
  const porElProxy =
    req.headers['x-forwarded-for'] !== undefined ||
    req.headers['x-forwarded-proto'] !== undefined ||
    req.headers['x-real-ip'] !== undefined;

  if (!porElProxy) return next(); // llamada interna (n8n, worker): como siempre

  // Usuario con sesión iniciada (la UI importa desde "Nuevo pedido").
  if (getRequesterContext(req).userId) return next();

  // O una clave de servicio.
  const { ok } = await resolveServiceKey(req);

  if (ok) return next();

  return res.status(401).json({
    error: 'Esta importación requiere iniciar sesión o una clave de API (x-api-key).',
  });
};
