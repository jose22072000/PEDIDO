import { z } from "zod";

import { RoleEnum } from "./usuario";

export const SesionLocalSchema = z.object({
  id: z.string(),
  token: z.string(),
  usuarioId: z.string(), // correo/email
  // Datos del trabajador
  trabajadorId: z.string().optional(), // ID interno del trabajador si existe
  trabajadorEmail: z.string(),
  trabajadorNombre: z.string(),
  trabajadorDni: z.string(),
  trabajadorTelefono: z.string().optional(),
  rol: RoleEnum,
  sucursalId: z.string().optional(),
  iat: z.number(),
  exp: z.number(),
});

export type SesionLocal = z.infer<typeof SesionLocalSchema>;

export const OtpSchema = z.object({
  id: z.string(),
  email: z.string().email("Correo inválido"),
  code: z.string().length(6, "El código debe tener 6 dígitos"),
  expiresAt: z.number(),
  used: z.boolean().default(false),
});

export type Otp = z.infer<typeof OtpSchema>;
