import { ReactNode, useEffect, useMemo } from "react";

import {
  useCategoriaStore,
  useGrupoStore,
  useProductoStore,
  useProveedorStore,
} from "@/stores/entityStores";
import { useProductCatalogStore } from "@/stores/productCatalogStore";

export const PedidoProvider = ({ children }: { children: ReactNode }) => {
  const { items: productos } = useProductoStore();
  const { items: categorias } = useCategoriaStore();
  const { items: grupos } = useGrupoStore();
  const { items: proveedores } = useProveedorStore();

  // select only the setters we need to avoid re-renders when reading the whole store
  const setItems = useProductCatalogStore((s) => s.setItems);
  const setLoading = useProductCatalogStore((s) => s.setLoading);
  const setCategorias = useProductCatalogStore((s) => s.setCategorias);
  const setGrupos = useProductCatalogStore((s) => s.setGrupos);
  const setProveedores = useProductCatalogStore((s) => s.setProveedores);

  const productosConRelaciones = useMemo(() => {
    return productos.map((producto) => {
      const categoria = categorias.find((c) => c.id === producto.categoriaId);
      const grupo = grupos.find((g) => g.id === producto.grupoId);
      const proveedor = proveedores.find((p) => p.id === producto.proveedorId);

      return {
        ...producto,
        categoriaNombre: categoria?.nombre || "",
        grupoNombre: grupo?.nombre || "",
        proveedorNombre: proveedor?.nombre || "",
      };
    });
    // We intentionally depend on the raw arrays from entity stores; memoization avoids repeated mapping.
  }, [productos, categorias, grupos, proveedores]);

  // Single effect: initialize store items and available filter options once when data arrives.
  useEffect(() => {
    if (!productosConRelaciones || productosConRelaciones.length === 0) return;

    setItems(productosConRelaciones);
    // initialize available option lists in the store (these are the data sources for filters)
    setCategorias(categorias);
    setGrupos(grupos);
    setProveedores(proveedores);

    // mark loading false once items are set
    setLoading(false);
  }, [
    productosConRelaciones,
    categorias,
    grupos,
    proveedores,
    setItems,
    setLoading,
    setCategorias,
    setGrupos,
    setProveedores,
  ]);

  return <>{children}</>;
};
