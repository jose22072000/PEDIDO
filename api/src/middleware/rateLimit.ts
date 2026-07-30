import rateLimit from 'express-rate-limit';

// Anti-bucle / anti-abuso: si un cliente entra en loop y machaca la API, esto acota el
// daño sin tumbar el server. Se clavea por IP (default de la librería, IPv6-safe): NO se
// usa el token como clave porque el header Authorization es SPOOFEABLE (un atacante manda
// tokens basura distintos → llaves infinitas → salta el límite). Con `trust proxy=1` la
// IP viene del X-Forwarded-For que pone nginx, no es falsificable.
// Límite MUY GENEROSO (6000/min ≈ 100/seg por IP) porque una sucursal entera comparte una
// sola IP pública (CGNAT de Starlink): una oficina trabajando no llega ni cerca; solo un
// bucle patológico lo alcanza. Los streams SSE (1 request de minutos) no cuentan.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 6000, // 6000 req/min por IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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
