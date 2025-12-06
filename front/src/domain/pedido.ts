import { z } from "zod";

export const EstadoPedidoEnum = z.enum([
  "PENDIENTE",
  "APROBADO",
  "RECHAZADO",
  "ENTREGADO",
]);
export type EstadoPedido = z.infer<typeof EstadoPedidoEnum>;

export const PedidoSchema = z.object({
  id: z.string(),
  trabajadorId: z.string(),
  sucursalId: z.string().optional(),
  negocioId: z.string().optional(),
  estado: EstadoPedidoEnum.default("PENDIENTE"),
  observacion: z.string().optional(),
  pendingSync: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Pedido = z.infer<typeof PedidoSchema>;

export const DetallePedidoSchema = z.object({
  id: z.string(),
  pedidoId: z.string(),
  productoId: z.string(),
  cantidad: z.number().min(1, "La cantidad debe ser mayor a 0"),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DetallePedido = z.infer<typeof DetallePedidoSchema>;
