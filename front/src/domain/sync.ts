import { z } from "zod";

export const OperacionEnum = z.enum(["CREATE", "UPDATE", "DELETE"]);
export type Operacion = z.infer<typeof OperacionEnum>;

export const SyncQueueSchema = z.object({
  id: z.string(),
  tabla: z.string(),
  operacion: OperacionEnum,
  registroId: z.string(),
  datos: z.any(),
  intentos: z.number().default(0),
  error: z.string().optional(),
  timestamp: z.number(),
  sincronizado: z.boolean().default(false),
});

export type SyncQueue = z.infer<typeof SyncQueueSchema>;

export const SyncStateSchema = z.object({
  id: z.string().default("global_sync_state"),
  lastSyncToken: z.string().optional(),
  lastPull: z.number().optional(),
  lastPush: z.number().optional(),
});

export type SyncState = z.infer<typeof SyncStateSchema>;

export const SyncFailedSchema = z.object({
  id: z.string(),
  tabla: z.string(),
  operacion: OperacionEnum,
  registroId: z.string(),
  datos: z.any(),
  error: z.string(),
  timestamp: z.number(),
});

export type SyncFailed = z.infer<typeof SyncFailedSchema>;
