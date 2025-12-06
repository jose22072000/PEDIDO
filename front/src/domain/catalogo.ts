import { z } from "zod";

export const CategoriaSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  codigo: z.string().min(1, "El código es requerido"),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Categoria = z.infer<typeof CategoriaSchema>;

export const GrupoSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  codigo: z.string().min(1, "El código es requerido"),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Grupo = z.infer<typeof GrupoSchema>;
