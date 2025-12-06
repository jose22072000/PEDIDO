import type { Producto, Proveedor } from "@/domain/producto";
import type { Categoria, Grupo } from "@/domain/catalogo";

import { create } from "zustand";

export type ProductoConRelaciones = Producto & {
  categoriaNombre?: string;
  grupoNombre?: string;
  proveedorNombre?: string;
};

export type SelectedItem = { id: string; cantidad: number };

export type ProductCatalogState = {
  filter: string;
  filterCategorias: Set<string>;
  filterGrupos: Set<string>;
  filterProveedores: Set<string>;
  grupos: Grupo[];
  categorias: Categoria[];
  proveedores: Proveedor[];
  items: ProductoConRelaciones[];
  // selected as an array of items to preserve order and be easier to iterate
  selected: SelectedItem[];
  // loading flag for async data / skeletons
  isLoading: boolean;

  // actions
  setFilter: (v: string) => void;
  setFilterCategorias: (ids: Set<string>) => void;
  setFilterGrupos: (ids: Set<string>) => void;
  setFilterProveedores: (ids: Set<string>) => void;
  setLoading: (v: boolean) => void;

  setGrupos: (grupos: Grupo[]) => void;
  setCategorias: (categorias: Categoria[]) => void;
  setProveedores: (proveedores: Proveedor[]) => void;

  toggleSelected: (id: string, cantidad?: number) => void;
  setQuantity: (id: string, cantidad: number) => void;
  removeSelected: (id: string) => void;
  clearSelection: () => void;
  setItems: (items: ProductoConRelaciones[]) => void;

  // computed helpers (callable selectors)
  getSelectedRecord: () => Record<string, number>;
  getSelectedCount: () => number;
  getSelectedTotalQuantity: () => number;
  getFilteredCount: () => number;
  getFilteredItems: () => ProductoConRelaciones[];
  getTotalItems: () => number;
};

export const useProductCatalogStore = create<ProductCatalogState>(
  (set, get) => ({
    filter: "",
    filterCategorias: new Set(),
    filterGrupos: new Set(),
    filterProveedores: new Set(),
    categorias: [],
    proveedores: [],
    grupos: [],
    items: [],
    selected: [],
    isLoading: true,

    setCategorias: (categorias: Categoria[]) => set(() => ({ categorias })),
    setGrupos: (grupos: Grupo[]) => set(() => ({ grupos })),
    setProveedores: (proveedores: Proveedor[]) => set(() => ({ proveedores })),
    setFilter: (v: string) => set(() => ({ filter: v })),
    setFilterCategorias: (ids: Set<string>) =>
      set(() => ({ filterCategorias: ids })),
    setFilterGrupos: (ids: Set<string>) => set(() => ({ filterGrupos: ids })),
    setFilterProveedores: (ids: Set<string>) =>
      set(() => ({ filterProveedores: ids })),
    setLoading: (v: boolean) => set(() => ({ isLoading: v })),

    toggleSelected: (id: string, cantidad = 1) =>
      set((state) => {
        const key = String(id);
        const exists = state.selected.find((s) => s.id === key);

        if (exists) {
          return { selected: state.selected.filter((s) => s.id !== key) };
        }

        return { selected: [...state.selected, { id: key, cantidad }] };
      }),

    setQuantity: (id: string, cantidad: number) =>
      set((state) => ({
        selected: state.selected.map((s) =>
          s.id === String(id) ? { ...s, cantidad } : s,
        ),
      })),

    removeSelected: (id: string) =>
      set((state) => ({
        selected: state.selected.filter((s) => s.id !== String(id)),
      })),

    clearSelection: () => set(() => ({ selected: [] })),
    setItems: (items: ProductoConRelaciones[]) => set(() => ({ items })),

    getSelectedRecord: () => {
      const rec: Record<string, number> = {};

      get().selected.forEach((s) => {
        rec[String(s.id)] = s.cantidad;
      });

      return rec;
    },

    getSelectedCount: () => get().selected.length,

    getSelectedTotalQuantity: () =>
      get().selected.reduce((acc, s) => acc + (Number(s.cantidad) || 0), 0),

    getFilteredCount: () => {
      const state = get();
      const q = state.filter?.toLowerCase?.() ?? "";

      return state.items.filter((producto) => {
        const matchesFilter = q
          ? producto.nombre.toLowerCase().includes(q) ||
            producto.sku?.toLowerCase().includes(q) ||
            producto.descripcion?.toLowerCase().includes(q) ||
            (producto.categoriaNombre || "").toLowerCase().includes(q) ||
            (producto.grupoNombre || "").toLowerCase().includes(q) ||
            (producto.proveedorNombre || "").toLowerCase().includes(q)
          : true;

        const matchesCategoria =
          state.filterCategorias.size > 0
            ? producto.categoriaId &&
              state.filterCategorias.has(producto.categoriaId)
            : true;
        const matchesGrupo =
          state.filterGrupos.size > 0
            ? producto.grupoId && state.filterGrupos.has(producto.grupoId)
            : true;
        const matchesProveedor =
          state.filterProveedores.size > 0
            ? producto.proveedorId &&
              state.filterProveedores.has(producto.proveedorId)
            : true;

        return (
          matchesFilter && matchesCategoria && matchesGrupo && matchesProveedor
        );
      }).length;
    },
    // return the filtered items according to current filters/search
    getFilteredItems: () => {
      const state = get();
      const q = state.filter?.toLowerCase?.() ?? "";

      return state.items.filter((producto) => {
        const matchesFilter = q
          ? producto.nombre.toLowerCase().includes(q) ||
            producto.sku?.toLowerCase().includes(q) ||
            producto.descripcion?.toLowerCase().includes(q) ||
            (producto.categoriaNombre || "").toLowerCase().includes(q) ||
            (producto.grupoNombre || "").toLowerCase().includes(q) ||
            (producto.proveedorNombre || "").toLowerCase().includes(q)
          : true;

        const matchesCategoria =
          state.filterCategorias.size > 0
            ? producto.categoriaId &&
              state.filterCategorias.has(producto.categoriaId)
            : true;
        const matchesGrupo =
          state.filterGrupos.size > 0
            ? producto.grupoId && state.filterGrupos.has(producto.grupoId)
            : true;
        const matchesProveedor =
          state.filterProveedores.size > 0
            ? producto.proveedorId &&
              state.filterProveedores.has(producto.proveedorId)
            : true;

        return (
          matchesFilter && matchesCategoria && matchesGrupo && matchesProveedor
        );
      });
    },
    getTotalItems: () => get().items.length,
  }),
);
