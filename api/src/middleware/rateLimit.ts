import rateLimit from 'express-rate-limit';

// Anti-bucle / anti-abuso: si un cliente entra en loop y machaca la API, esto acota el
// daño sin tumbar el server. Límite GENEROSO a propósito: muchos usuarios comparten una
// misma IP pública (CGNAT de Starlink) — no queremos bloquear oficinas enteras, solo
// frenar floods patológicos. La clave prioriza el USUARIO (token) por encima de la IP,
// así un bucle de un cliente no gasta el cupo de sus compañeros de red.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 1200, // 1200 req/min por clave: una oficina entera cabe; un bucle no.
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth && auth.length > 16) return `t:${auth.slice(-24)}`; // por usuario si hay token

    return `ip:${req.ip}`;
  },
  // Los streams SSE son long-lived (1 request que dura minutos): no deben contar.
  skip: (req) =>
    req.path.includes('/events/stream') || req.path.includes('/import-stream'),
  message: {
    error: 'Demasiadas solicitudes en poco tiempo. Espera un momento e intenta de nuevo.',
  },
});

// Login: frena fuerza bruta PERO holgado para una oficina entera tras un mismo NAT
// (CGNAT de Starlink → toda la sucursal comparte IP pública). 300/5min ≈ 1/seg: una
// oficina tecleando su clave a las 8am no se bloquea; un atacante sí queda frenado.
export const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  limit: 300, // 300 intentos/5min por IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.',
  },
});
