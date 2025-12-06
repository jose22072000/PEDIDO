import { z } from "zod";

export const VisitaSchema = z.object({
  id: z.string(),
  trabajadorId: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  ubicacion: z.string().optional(),
  negocioId: z.string().optional(),
  observacion: z.string().optional(),
  pendingSync: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Visita = z.infer<typeof VisitaSchema>;
