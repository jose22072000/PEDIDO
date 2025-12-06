import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "procovar_db";
const DB_VERSION = 2;

let dbInstance: IDBPDatabase | null = null;

export async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Usuarios (uses correo as primary key)
      if (!db.objectStoreNames.contains("usuarios")) {
        db.createObjectStore("usuarios", { keyPath: "correo" });
      } else if (oldVersion < 2) {
        // Migration: recreate store with new keyPath
        db.deleteObjectStore("usuarios");
        db.createObjectStore("usuarios", { keyPath: "correo" });
      }
      if (!db.objectStoreNames.contains("sucursales")) {
        db.createObjectStore("sucursales", { keyPath: "id" });
      }

      // Catálogo
      if (!db.objectStoreNames.contains("categorias")) {
        db.createObjectStore("categorias", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("grupos")) {
        db.createObjectStore("grupos", { keyPath: "id" });
      }

      // Productos y Proveedores
      if (!db.objectStoreNames.contains("productos")) {
        db.createObjectStore("productos", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("proveedores")) {
        db.createObjectStore("proveedores", { keyPath: "id" });
      }

      // Ventas
      if (!db.objectStoreNames.contains("ventas")) {
        db.createObjectStore("ventas", { keyPath: "id" });
      }

      // Pedidos
      if (!db.objectStoreNames.contains("pedidos")) {
        db.createObjectStore("pedidos", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("detalles_pedidos")) {
        db.createObjectStore("detalles_pedidos", { keyPath: "id" });
      }

      // Visitas
      if (!db.objectStoreNames.contains("visitas")) {
        db.createObjectStore("visitas", { keyPath: "id" });
      }

      // Trabajadores (uses email as primary key)
      if (!db.objectStoreNames.contains("trabajadores")) {
        db.createObjectStore("trabajadores", { keyPath: "email" });
      } else if (oldVersion < 2) {
        // Migration: recreate store with new keyPath
        db.deleteObjectStore("trabajadores");
        db.createObjectStore("trabajadores", { keyPath: "email" });
      }

      // Negocios y Contactos
      if (!db.objectStoreNames.contains("negocios")) {
        db.createObjectStore("negocios", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("contactos")) {
        db.createObjectStore("contactos", { keyPath: "id" });
      }

      // Sincronización
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.createObjectStore("sync_queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sync_state")) {
        db.createObjectStore("sync_state", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sync_failed")) {
        db.createObjectStore("sync_failed", { keyPath: "id" });
      }

      // Sesión
      if (!db.objectStoreNames.contains("sesion_local")) {
        db.createObjectStore("sesion_local", { keyPath: "id" });
      }
    },
  });

  return dbInstance;
}

// Helper CRUD
export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await getDB();

  return db.getAll(storeName) as Promise<T[]>;
}

export async function getById<T>(
  storeName: string,
  id: string,
): Promise<T | undefined> {
  const db = await getDB();

  return db.get(storeName, id) as Promise<T | undefined>;
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await getDB();

  await db.put(storeName, value);
}

export async function bulkPut<T>(
  storeName: string,
  values: T[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, "readwrite");

  await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
}

export async function del(storeName: string, id: string): Promise<void> {
  const db = await getDB();

  await db.delete(storeName, id);
}

export async function clear(storeName: string): Promise<void> {
  const db = await getDB();

  await db.clear(storeName);
}

export async function count(storeName: string): Promise<number> {
  const db = await getDB();

  return db.count(storeName);
}

export async function query<T>(
  storeName: string,
  predicate: (item: T) => boolean,
): Promise<T[]> {
  const all = await getAll<T>(storeName);

  return all.filter(predicate);
}
