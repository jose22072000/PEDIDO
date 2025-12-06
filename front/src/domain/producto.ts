import { z } from "zod";

export const ProductoSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  sku: z.string().min(1, "El SKU es requerido"),
  categoriaId: z.string().optional(),
  grupoId: z.string().optional(),
  descripcion: z.string().optional(),
  sucursalId: z.string().optional(),
  proveedorId: z.string().optional(),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Producto = z.infer<typeof ProductoSchema>;

export const ProveedorSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  correo: z.string().email("Correo inválido").optional(),
  direccion: z.string().optional(),
  activo: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Proveedor = z.infer<typeof ProveedorSchema>;
