import { z } from "zod";

export const RoleEnum = z.enum([
  "ADMIN",
  "VENDEDOR",
  "CONTADOR",
  "OPERADOR",
  "ANALISTA",
  "DIRECTIVO",
  "SUPERVISOR",
  "GERENTE",
  "VIEWER",
]);
export type Role = z.infer<typeof RoleEnum>;

export const UsuarioSchema = z.object({
  correo: z.string().email("Correo inválido"),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Usuario = z.infer<typeof UsuarioSchema>;
