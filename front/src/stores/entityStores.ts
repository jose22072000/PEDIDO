import type {
  Producto,
  Proveedor,
  Categoria,
  Grupo,
  Sucursal,
  Venta,
  Pedido,
  DetallePedido,
  Visita,
  Trabajador,
  Negocio,
  Contacto,
} from '@/domain';
import { create } from "zustand";

import { getAll, getById, put, del } from "@/lib/db";
import { enqueueOperation } from "@/lib/sync";

interface EntityStore<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadAll: () => Promise<void>;
  getById: (id: string) => T | undefined;
  create: (item: T) => Promise<void>;
  update: (id: string, item: Partial<T>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function createEntityStore<
  T extends { id: string; createdAt: number; updatedAt: number },
>(storeName: string) {
  return create<EntityStore<T>>((set, get) => ({
    items: [],
    isLoading: false,
    error: null,

    loadAll: async () => {
      set({ isLoading: true, error: null });
      try {
        const items = await getAll<T>(storeName);

        set({ items, isLoading: false });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Error loading data",
          isLoading: false,
        });
      }
    },

    getById: (id: string) => {
      return get().items.find((item) => item.id === id);
    },

    create: async (item: T) => {
      try {
        const now = Date.now();
        const newItem = { ...item, createdAt: now, updatedAt: now };

        await put(storeName, newItem);
        await enqueueOperation(storeName, "CREATE", newItem.id, newItem);

        set({ items: [...get().items, newItem] });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Error creating item",
        });
      }
    },

    update: async (id: string, updates: Partial<T>) => {
      try {
        const existing = await getById<T>(storeName, id);

        if (!existing) throw new Error("Item not found");

        const updated = { ...existing, ...updates, updatedAt: Date.now() };

        await put(storeName, updated);
        await enqueueOperation(storeName, "UPDATE", id, updated);

        set({
          items: get().items.map((item) => (item.id === id ? updated : item)),
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Error updating item",
        });
      }
    },

    remove: async (id: string) => {
      try {
        await del(storeName, id);
        await enqueueOperation(storeName, "DELETE", id, { id });

        set({
          items: get().items.filter((item) => item.id !== id),
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Error deleting item",
        });
      }
    },

    refresh: async () => {
      await get().loadAll();
    },
  }));
}

// Crear stores tipados para cada entidad
export const useProductoStore = createEntityStore<Producto>("productos");
export const useProveedorStore = createEntityStore<Proveedor>("proveedores");
export const useCategoriaStore = createEntityStore<Categoria>("categorias");
export const useGrupoStore = createEntityStore<Grupo>("grupos");
export const useSucursalStore = createEntityStore<Sucursal>("sucursales");
export const useVentaStore = createEntityStore<Venta>("ventas");
export const usePedidoStore = createEntityStore<Pedido>("pedidos");
export const useDetallePedidoStore =
  createEntityStore<DetallePedido>("detalles_pedidos");
export const useVisitaStore = createEntityStore<Visita>("visitas");
export const useNegocioStore = createEntityStore<Negocio>("negocios");
export const useContactoStore = createEntityStore<Contacto>("contactos");

// Trabajador uses email as PK, so we need a specialized store
interface TrabajadorStore {
  items: Trabajador[];
  isLoading: boolean;
  error: string | null;
  loadAll: () => Promise<void>;
  getByEmail: (email: string) => Trabajador | undefined;
  create: (item: Trabajador) => Promise<void>;
  update: (email: string, item: Partial<Trabajador>) => Promise<void>;
  remove: (email: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useTrabajadorStore = create<TrabajadorStore>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  loadAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await getAll<Trabajador>("trabajadores");

      set({ items, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error loading data",
        isLoading: false,
      });
    }
  },

  getByEmail: (email: string) => {
    return get().items.find((item) => item.email === email);
  },

  create: async (item: Trabajador) => {
    try {
      const now = Date.now();
      const newItem = { ...item, createdAt: now, updatedAt: now };

      await put("trabajadores", newItem);
      await enqueueOperation("trabajadores", "CREATE", newItem.email, newItem);

      set({ items: [...get().items, newItem] });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error creating item",
      });
    }
  },

  update: async (email: string, updates: Partial<Trabajador>) => {
    try {
      const existing = await getById<Trabajador>("trabajadores", email);

      if (!existing) throw new Error("Item not found");

      const updated = { ...existing, ...updates, updatedAt: Date.now() };

      await put("trabajadores", updated);
      await enqueueOperation("trabajadores", "UPDATE", email, updated);

      set({
        items: get().items.map((item) =>
          item.email === email ? updated : item,
        ),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error updating item",
      });
    }
  },

  remove: async (email: string) => {
    try {
      await del("trabajadores", email);
      await enqueueOperation("trabajadores", "DELETE", email, null);

      set({ items: get().items.filter((item) => item.email !== email) });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error deleting item",
      });
    }
  },

  refresh: async () => {
    await get().loadAll();
  },
}));
