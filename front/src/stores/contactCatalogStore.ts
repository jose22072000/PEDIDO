import type { Contacto } from "@/domain";

import { create } from "zustand";

import { useContactoStore, useNegocioStore } from "./entityStores";

import { useAuthStore } from "@/stores/authStore";

export type ContactCatalogState = {
  items: Contacto[];
  isLoading: boolean;
  setItems: (items: Contacto[]) => void;
  setLoading: (v: boolean) => void;
  refresh: () => Promise<void>;

  // callable selectors
  getEmpresaContacts: () => Contacto[];
  getMyContacts: () => Contacto[];
  getSucursalContacts: () => Contacto[];
};

export const useContactCatalogStore = create<ContactCatalogState>(
  (set, get) => ({
    items: [],
    isLoading: true,
    setItems: (items: Contacto[]) => set(() => ({ items })),
    setLoading: (v: boolean) => set(() => ({ isLoading: v })),

    refresh: async () => {
      set({ isLoading: true });
      try {
        // delegate loading to the canonical contacto store
        await useContactoStore.getState().loadAll();
        const loaded = useContactoStore.getState().items || [];

        set({ items: loaded });
      } catch (err) {
        // ignore, entity store carries errors
      } finally {
        set({ isLoading: false });
      }
    },

    getEmpresaContacts: () => {
      return get().items || [];
    },

    getMyContacts: () => {
      const user = useAuthStore.getState().user;

      if (!user) return [];
      
      // TODO: Filter by user - requires API support
      return get().items || [];
    },

    getSucursalContacts: () => {
      const user = useAuthStore.getState().user;

      if (!user) return [];
      
      // TODO: Filter by sucursal - requires API support
      return get().items || [];
    },
  }),
);

// keep the contact catalog in sync with the canonical contacto store
// whenever contactos change, update this catalog store's items
useContactoStore.subscribe((state) => {
  useContactCatalogStore.setState({ items: state.items || [] });
});

// initialize: copy current items if any
const initial = useContactoStore.getState().items || [];

if (initial.length > 0) {
  useContactCatalogStore.setState({ items: initial, isLoading: false });
}

export default useContactCatalogStore;
