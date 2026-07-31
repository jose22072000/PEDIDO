import { Request, Response, NextFunction } from 'express';
import { verifyApiKeyToken } from '../lib/apiKey';

/**
 * Deja que una API key (`x-api-key`) actúe como identidad GLOBAL de LECTURA en los
 * endpoints de datos (sucursales, orders, clientes, reports...). Así otros proyectos
 * pueden consumir TODA la data con su key.
 *
 * Solo para métodos de lectura (GET/HEAD): las MUTACIONES por key no se habilitan aquí
 * (para escribir de servidor-a-servidor está `/integration/*` con su serviceAuth).
 * Marca `req.apiKeyCtx`; getRequesterContext lo lee y devuelve un contexto global.
 */
// Rutas que una API key NUNCA puede leer (gestión de usuarios y de las propias keys):
// la key ve TODA la data MENOS los usuarios.
const BLOQUEADAS = ['/users', '/api-keys'];

export const apiKeyAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = (req.headers['x-api-key'] || req.headers['X-Api-Key']) as string | undefined;
    const path = req.path || '';
    const bloqueada = BLOQUEADAS.some((p) => path === p || path.startsWith(p + '/'));
    if (header && !bloqueada && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = await verifyApiKeyToken(header, req);
      if (key) {
        (req as any).apiKeyCtx = { id: key.id, label: key.label };
      }
    }
  } catch {
    // best-effort: si falla la verificación, sigue sin identidad de key
  }
  next();
};
