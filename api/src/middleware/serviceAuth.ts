import { Request, Response, NextFunction } from 'express';
import { resolveServiceKey } from '../lib/apiKey';

// Auth servidor-a-servidor (delivery / otros proyectos -> PEDIDO). Header `x-api-key`.
// Acepta la SERVICE_API_KEY legacy (env, la de delivery) O una key emitida en la tabla
// ApiKey (multi-proyecto, con tracking de uso). Sin JWT de usuario.
export const serviceAuth = async (req: Request, res: Response, next: NextFunction) => {
  const { ok } = await resolveServiceKey(req);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid or missing x-api-key' });
  }
  next();
};
