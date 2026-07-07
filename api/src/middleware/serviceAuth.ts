import { Request, Response, NextFunction } from 'express';

// Auth servidor-a-servidor (delivery -> PEDIDO). Header `x-api-key` que debe
// coincidir con SERVICE_API_KEY. Sin JWT de usuario.
export const serviceAuth = (req: Request, res: Response, next: NextFunction) => {
  const key = (req.headers['x-api-key'] || req.headers['X-Api-Key']) as string | undefined;
  if (!process.env.SERVICE_API_KEY || key !== process.env.SERVICE_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing x-api-key' });
  }
  next();
};
