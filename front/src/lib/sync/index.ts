import type {
  SyncQueue,
  SyncState,
  SyncFailed,
  Operacion,
  SesionLocal,
} from "@/domain";

import { getAll, put, getById, del } from "../db";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8400";
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE = 2000;

// Pull: descargar cambios desde el servidor
export async function pullChanges(): Promise<void> {
  try {
    const syncState = await getById<SyncState>(
      "sync_state",
      "global_sync_state",
    );
    const lastToken = syncState?.lastSyncToken;

    const url = lastToken
      ? `${API_BASE_URL}/sync/pull?token=${lastToken}`
      : `${API_BASE_URL}/sync/pull`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await getAuthToken()}`,
      },
    });

    if (!response.ok) throw new Error("Error al descargar cambios");

    const data = await response.json();

    await mergeServerChanges(data.changes);

    // Actualizar token
    await put<SyncState>("sync_state", {
      id: "global_sync_state",
      lastSyncToken: data.nextToken,
      lastPull: Date.now(),
      lastPush: syncState?.lastPush,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error en pullChanges:", error);
  }
}

// Push: enviar cola de sincronización al servidor
export async function pushQueue(): Promise<void> {
  const queue = await getAll<SyncQueue>("sync_queue");
  const pending = queue.filter((item) => !item.sincronizado);

  for (const item of pending) {
    if (item.intentos >= MAX_ATTEMPTS) {
      // Mover a dead-letter queue
      await put<SyncFailed>("sync_failed", {
        id: item.id,
        tabla: item.tabla,
        operacion: item.operacion,
        registroId: item.registroId,
        datos: item.datos,
        error: item.error || "Max attempts exceeded",
        timestamp: Date.now(),
      });
      await del("sync_queue", item.id);
      continue;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await getAuthToken()}`,
        },
        body: JSON.stringify({
          tabla: item.tabla,
          operacion: item.operacion,
          registroId: item.registroId,
          datos: item.datos,
        }),
      });

      if (!response.ok) throw new Error("Error al sincronizar");

      const result = await response.json();

      // Actualizar entidad local con versión canonical del servidor
      if (result.entity && item.operacion !== "DELETE") {
        await put(item.tabla, result.entity);
      }

      // Marcar como sincronizado
      await put<SyncQueue>("sync_queue", {
        ...item,
        sincronizado: true,
      });

      // Actualizar lastPush
      const syncState = await getById<SyncState>(
        "sync_state",
        "global_sync_state",
      );

      await put<SyncState>("sync_state", {
        id: "global_sync_state",
        lastSyncToken: syncState?.lastSyncToken,
        lastPull: syncState?.lastPull,
        lastPush: Date.now(),
      });
    } catch (error) {
      const waitTime = backoff(item.intentos);

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      await put<SyncQueue>("sync_queue", {
        ...item,
        intentos: item.intentos + 1,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

// Merge: integrar cambios del servidor en local
export async function mergeServerChanges(changes: any[]): Promise<void> {
  for (const change of changes) {
    const { tabla, operacion, entity } = change;

    // Determine the primary key field based on table
    const getPrimaryKey = (tableName: string, entityData: any) => {
      if (tableName === "trabajadores") {
        return entityData.email;
      }
      if (tableName === "usuarios") {
        return entityData.correo;
      }

      return entityData.id;
    };

    const primaryKey = getPrimaryKey(tabla, entity);

    if (!primaryKey) {
      // eslint-disable-next-line no-console
      console.error("No primary key found for entity", { tabla, entity });
      continue;
    }

    if (operacion === "DELETE") {
      await del(tabla, primaryKey);
    } else {
      // Detectar conflictos
      const local = await getById(tabla, primaryKey);

      if (local && detectConflicts(local, entity)) {
        // eslint-disable-next-line no-console
        console.warn("Conflicto detectado, aplicando server-wins", {
          local,
          server: entity,
        });
      }
      await put(tabla, entity);
    }
  }
}

// Backoff exponencial
export function backoff(attempt: number): number {
  return Math.min(BACKOFF_BASE * Math.pow(2, attempt), 30000);
}

// Detectar conflictos (server-wins)
export function detectConflicts(local: any, server: any): boolean {
  return (
    local.updatedAt && server.updatedAt && local.updatedAt > server.updatedAt
  );
}

// Encolar operación
export async function enqueueOperation(
  tabla: string,
  operacion: Operacion,
  registroId: string,
  datos: any,
): Promise<void> {
  const id = `${tabla}_${operacion}_${registroId}_${Date.now()}`;

  await put<SyncQueue>("sync_queue", {
    id,
    tabla,
    operacion,
    registroId,
    datos,
    intentos: 0,
    timestamp: Date.now(),
    sincronizado: false,
  });
}

// Obtener estadísticas de sincronización
export async function getSyncStats() {
  const queue = await getAll<SyncQueue>("sync_queue");
  const failed = await getAll<SyncFailed>("sync_failed");
  const syncState = await getById<SyncState>("sync_state", "global_sync_state");

  return {
    pending: queue.filter((item) => !item.sincronizado).length,
    synced: queue.filter((item) => item.sincronizado).length,
    failed: failed.length,
    lastPull: syncState?.lastPull,
    lastPush: syncState?.lastPush,
    lastSyncToken: syncState?.lastSyncToken,
  };
}

// Forzar sincronización completa
export async function forceSyncAll(): Promise<void> {
  await pullChanges();
  await pushQueue();
}

// Helper para obtener token de autenticación
async function getAuthToken(): Promise<string | null> {
  const session = await getById<SesionLocal>("sesion_local", "current_session");

  return session?.token || null;
}
