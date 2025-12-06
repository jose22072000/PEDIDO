import { z } from "zod";

export const VentaSchema = z.object({
  id: z.string(),
  numeroOperacion: z.string().min(1, "El número de operación es requerido"),
  fechaHora: z.number(),
  cantidad: z.number().min(0, "La cantidad debe ser mayor o igual a 0"),
  precioVenta: z.number().min(0, "El precio debe ser mayor o igual a 0"),
  importe: z.number().min(0, "El importe debe ser mayor o igual a 0"),
  operador: z.string().min(1, "El operador es requerido"),
  observacion: z.string().optional(),
  trabajadorId: z.string(),
  productoId: z.string(),
  sucursalId: z.string(),
  pendingSync: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Venta = z.infer<typeof VentaSchema>;
