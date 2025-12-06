import { z } from "zod";

export const NegocioSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1, "El nombre es requerido"),
  direccion: z.string().min(1, "La dirección es requerida"),
  provincia: z.string().optional(),
  municipio: z.string().optional(),
  reparto: z.string().optional(),
  coordenadas: z.string().optional(), // "lat,lng" format
  lat: z.number().optional(),
  lng: z.number().optional(),
  descripcion: z.string().optional(),
  alias: z.string().optional(),
  trabajadorAsignado: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Negocio = z.infer<typeof NegocioSchema>;

export const TipoContactoEnum = z.enum(["PROPIETARIO", "EMPLEADO", "OTRO"]);
export type TipoContacto = z.infer<typeof TipoContactoEnum>;

export const ContactoSchema = z.object({
  id: z.string(),
  negocioId: z.string(),
  tipo: TipoContactoEnum,
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  correo: z.string().email("Correo inválido").optional(),
  descripcion: z.string().optional(),
  alias: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Contacto = z.infer<typeof ContactoSchema>;
