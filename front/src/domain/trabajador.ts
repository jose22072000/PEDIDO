import { z } from "zod";

import { RoleEnum } from "./usuario";

export const TrabajadorSchema = z.object({
  email: z.string().email("Correo inválido"),
  nombre: z.string().min(1, "El nombre es requerido"),
  dni: z.string().min(1, "El DNI es requerido"),
  telefono: z.string().optional(),
  rol: RoleEnum,
  sucursalId: z.string().optional(),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Trabajador = z.infer<typeof TrabajadorSchema>;
