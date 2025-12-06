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
      const session = useAuthStore.getState().session;

      if (!session) return [];
      const uid = session.usuarioId;

      return (get().items || []).filter((c: any) => {
        // permissive checks for common creator fields
        if (c.usuarioId && c.usuarioId === uid) return true;
        if (c.createdBy && c.createdBy === uid) return true;
        if (c.ownerId && c.ownerId === uid) return true;
        if (c.meta && c.meta.creator === uid) return true;

        return false;
      });
    },

    getSucursalContacts: () => {
      const session = useAuthStore.getState().session;

      if (!session) return [];
      const sid = session.sucursalId;

      if (!sid) return [];

      const negocios = useNegocioStore.getState().items || [];

      return (get().items || []).filter((c: any) => {
        if (c.sucursalId && c.sucursalId === sid) return true;
        if (c.negocioId) {
          const negocio = negocios.find((n: any) => n.id === c.negocioId);

          if (!negocio) return false;
          if (
            (negocio as any).sucursalId &&
            (negocio as any).sucursalId === sid
          )
            return true;
          if ((negocio as any).sucursal && (negocio as any).sucursal.id === sid)
            return true;
        }

        return false;
      });
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
