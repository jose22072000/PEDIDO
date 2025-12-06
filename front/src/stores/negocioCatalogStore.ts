import type { Negocio } from "@/domain/negocio";

import { create } from "zustand";

import { useNegocioStore, useTrabajadorStore } from "./entityStores";

export type NegocioCatalogState = {
  items: Negocio[];
  isLoading: boolean;
  filter: string;
  filterSucursalId?: string;
  filterTrabajadorEmail?: string;
  filterSinAsignar: boolean; // Nuevo: filtro para negocios sin asignar
  filteredItems: Negocio[]; // Nuevo: items ya filtrados
  listTrabajadores: string[]; // Nuevo: lista de emails de trabajadores
  setListTrabajadores: (emails: string[]) => void;
  setItems: (items: Negocio[]) => void;
  setLoading: (v: boolean) => void;
  setFilter: (s: string) => void;
  setFilterSucursal: (id?: string) => void;
  setFilterTrabajador: (email?: string) => void;
  setFilterSinAsignar: (value: boolean) => void; // Nuevo: setter para sin asignar
  refresh: () => Promise<void>;
  updateFilteredItems: () => void; // Nuevo: recalcular filtros

  // callable selectors - deprecated, usar filteredItems
  getFilteredItems: () => Negocio[];
};

const applyFilters = (
  items: Negocio[],
  textFilter: string,
  sucursalId: string | undefined,
  trabajadorEmail: string | undefined,
  sinAsignar: boolean,
): Negocio[] => {
  let list = items || [];

  // Filter by sin asignar (negocios without trabajadorAsignado)
  if (sinAsignar) {
    list = list.filter((n) => !n.trabajadorAsignado);

    // Si solo queremos sin asignar, no aplicar otros filtros
    return list;
  }

  // Filter by sucursal - get trabajadores from that sucursal first
  if (sucursalId && sucursalId !== "__all__") {
    const trabajadores = useTrabajadorStore.getState().items || [];
    const trabajadoresEnSucursal = trabajadores
      .filter((t) => t.sucursalId === sucursalId)
      .map((t) => t.email);

    // Filter negocios assigned to trabajadores in that sucursal
    list = list.filter(
      (n) =>
        n.trabajadorAsignado &&
        trabajadoresEnSucursal.includes(n.trabajadorAsignado),
    );
  }

  // Filter by trabajador asignado
  if (trabajadorEmail && trabajadorEmail !== "__all__") {
    list = list.filter((n) => n.trabajadorAsignado === trabajadorEmail);
  }

  // Text search filter
  const q = (textFilter || "").toLowerCase().trim();

  if (!q) return list;

  return list.filter((n) => {
    const name = (n.nombre || "").toLowerCase();
    const alias = (n.alias || "").toLowerCase();
    const direccion = (n.direccion || "").toLowerCase();

    return name.includes(q) || alias.includes(q) || direccion.includes(q);
  });
};

export const useNegocioCatalogStore = create<NegocioCatalogState>(
  (set, get) => ({
    items: [],
    trabajadores: [],
    filteredItems: [],
    listTrabajadores: [],
    isLoading: true,
    filter: "",
    filterSucursalId: undefined,
    filterTrabajadorEmail: undefined,
    filterSinAsignar: false,
    setListTrabajadores(emails) {
      set({ listTrabajadores: emails });
    },
    setItems: (items: Negocio[]) => {
      set({ items });
      get().updateFilteredItems();
    },

    setLoading: (v: boolean) => set({ isLoading: v }),

    setFilter: (s: string) => {
      set({ filter: s });
      get().updateFilteredItems();
    },

    setFilterSucursal: (id?: string) => {
      set({ filterSucursalId: id });
      get().updateFilteredItems();
    },

    setFilterTrabajador: (email?: string) => {
      set({ filterTrabajadorEmail: email });
      get().updateFilteredItems();
    },

    setFilterSinAsignar: (value: boolean) => {
      set({ filterSinAsignar: value });
      get().updateFilteredItems();
    },

    updateFilteredItems: () => {
      const state = get();
      const filtered = applyFilters(
        state.items,
        state.filter,
        state.filterSucursalId,
        state.filterTrabajadorEmail,
        state.filterSinAsignar,
      );

      set({ filteredItems: filtered });
    },

    refresh: async () => {
      set({ isLoading: true });
      try {
        await useNegocioStore.getState().loadAll();
        const loaded = useNegocioStore.getState().items || [];

        set({ items: loaded });
        get().updateFilteredItems();
      } catch (err) {
        // ignore, entity store holds errors
      } finally {
        set({ isLoading: false });
      }
    },

    getFilteredItems: () => {
      // Deprecated: usar filteredItems directamente
      return get().filteredItems;
    },
  }),
);

// keep in sync with canonical store
useNegocioStore.subscribe((s) => {
  useNegocioCatalogStore.setState({ items: s.items || [] });
  useNegocioCatalogStore.getState().updateFilteredItems();
});

// Re-filter when trabajadores change (needed for sucursal filter)
useTrabajadorStore.subscribe(() => {
  useNegocioCatalogStore.getState().updateFilteredItems();
});

const initial = useNegocioStore.getState().items || [];

if (initial.length > 0) {
  useNegocioCatalogStore.setState({ items: initial, isLoading: false });
  useNegocioCatalogStore.getState().updateFilteredItems();
}

export default useNegocioCatalogStore;
