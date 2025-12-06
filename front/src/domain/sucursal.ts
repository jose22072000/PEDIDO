import { z } from "zod";

export const SucursalSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  codigo: z.string().min(1, "El código es requerido"),
  ciudad: z.string().min(1, "La ciudad es requerida"),
  direccion: z.string().optional(),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Sucursal = z.infer<typeof SucursalSchema>;
