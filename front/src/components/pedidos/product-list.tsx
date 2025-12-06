import {
  Card,
  CardBody,
  Chip,
  Pagination,
  Tooltip,
  Input,
  Button,
  ButtonGroup,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { useProductCatalogStore } from "@/stores/productCatalogStore";
import { cn } from "@/lib/utils";

export const CatalogSelection = () => {
  // cache the store function reference and memoize the computed list
  const getFilteredItems = useProductCatalogStore((s) => s.getFilteredItems);
  const grupos = useProductCatalogStore((s) => s.grupos);
  const categorias = useProductCatalogStore((s) => s.categorias);
  const proveedores = useProductCatalogStore((s) => s.proveedores);
  const productoItems = useProductCatalogStore((s) => s.items);
  const filter = useProductCatalogStore((s) => s.filter);
  const filterCategorias = useProductCatalogStore((s) => s.filterCategorias);
  const filterGrupos = useProductCatalogStore((s) => s.filterGrupos);
  const filterProveedores = useProductCatalogStore((s) => s.filterProveedores);

  const selectedArray = useProductCatalogStore((s) => s.selected);
  const toggleSelected = useProductCatalogStore((s) => s.toggleSelected);

  const catalogo = useMemo(() => {
    // call the store's function inside a memo so the snapshot is stable
    // and only recalculated when filter inputs actually change
    const cat = getFilteredItems();

    return cat;
    // stringify sets to use as deps (detect changes in their contents)
  }, [
    getFilteredItems,
    filter,
    filterCategorias,
    filterGrupos,
    filterProveedores,
    productoItems,
    grupos,
    categorias,
    proveedores,
  ]);

  // helper map for quick lookup
  const selectedProducts = useMemo(
    () =>
      new Map<string, number>(
        selectedArray.map((x) => [String(x.id), Number(x.cantidad)]),
      ),
    [selectedArray],
  );

  // Paginación
  const [page, setPage] = useState<number>(1);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(catalogo.length / pageSize));
  const pagedCatalog = useMemo(() => {
    const start = (page - 1) * pageSize;

    return catalogo.slice(start, start + pageSize);
  }, [catalogo, page]);

  // Resetear página cuando cambian filtros o búsqueda
  useEffect(() => {
    setPage(1);
  }, [filter, filterCategorias, filterGrupos, filterProveedores]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pagedCatalog.map((producto) => (
          <Card
            key={producto.id}
            isPressable
            className={cn(
              selectedProducts.has(String(producto.id))
                ? cards({ border: "successHover" })
                : cards({ border: "primaryHover" }),
            )}
            onPress={() => toggleSelected(String(producto.id), 1)}
          >
            <CardBody className="p-0">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex gap-1 items-start">
                    <div className="relative min-w-12">
                      <Tooltip content="Logo de Producto">
                        <Icons.productos className="size-12 text-white" />
                      </Tooltip>
                    </div>
                    <h3 className="font-bold text-large text-pretty">
                      {producto.nombre}
                    </h3>
                  </div>

                  <div className="relative min-w-8">
                    <Tooltip content="Seleccionar">
                      {selectedProducts.has(String(producto.id)) ? (
                        <Icons.check className="size-8 text-success" />
                      ) : (
                        <Icons.unCheck className="size-8" />
                      )}
                    </Tooltip>
                  </div>
                </div>

                <div className="flex justify-between gap-2">
                  {producto.grupoNombre && (
                    <Chip
                      endContent={<Icons.tag className="size-3" />}
                      size="sm"
                      variant="bordered"
                    >
                      {producto.grupoNombre}
                    </Chip>
                  )}
                  {producto.proveedorNombre && (
                    <Chip
                      size="sm"
                      startContent={<Icons.partners className="size-3" />}
                      variant="bordered"
                    >
                      {producto.proveedorNombre}
                    </Chip>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Estado vacío */}
      {catalogo.length === 0 && (
        <Card className={cards({ border: true })}>
          <CardBody className="text-center py-6">
            <p className="text-default-500">
              No se encontraron productos con los filtros aplicados
            </p>
          </CardBody>
        </Card>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex w-full justify-center">
          <Pagination
            isCompact
            showControls
            showShadow
            classNames={{
              wrapper: "shadow-xl shadow-primary/5",
              item: "cursor-pointer font-semibold",
              cursor: "font-semibold",
            }}
            color="primary"
            page={page}
            siblings={0}
            size="lg"
            total={totalPages}
            onChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
};

export const ProductSelectionQuantity = () => {
  const selected = useProductCatalogStore((s) => s.selected);
  const items = useProductCatalogStore((s) => s.items);
  const setQuantity = useProductCatalogStore((s) => s.setQuantity);
  const removeSelected = useProductCatalogStore((s) => s.removeSelected);

  const itemsMap = useMemo(
    () => new Map(items.map((it) => [String(it.id), it])),
    [items],
  );

  if (!selected || selected.length === 0) {
    return (
      <Card className={cards({ border: true })}>
        <CardBody className="text-center py-3">
          <p className="text-default-500">No hay productos seleccionados</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {selected.map((sItem) => {
        const producto = itemsMap.get(String(sItem.id));

        return (
          <Card key={sItem.id} className={cards({ border: "default" })}>
            <CardBody className="p-0">
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex gap-1 items-start">
                    <div className="flex min-w-12">
                      <Icons.productos className="size-12 text-white" />
                    </div>
                    <h3 className="font-semibold text-pretty">
                      {producto?.nombre ?? `Producto ${sItem.id}`}
                    </h3>
                  </div>
                  <Button
                    isIconOnly
                    aria-label={`Eliminar ${sItem.id}`}
                    color="danger"
                    variant="ghost"
                    onPress={() => removeSelected(String(sItem.id))}
                  >
                    <Icons.trash className="size-6" />
                  </Button>
                </div>
                <div className="w-full flex items-center gap-2">
                  <ButtonGroup
                    className="bg-transparent"
                    fullWidth={true}
                    radius="sm"
                    size="lg"
                    variant="bordered"
                  >
                    <Button
                      isIconOnly
                      aria-label={`Disminuir cantidad ${sItem.id}`}
                      color="default"
                      variant="ghost"
                      onPress={() => {
                        const cur = Number(sItem.cantidad) || 1;
                        const v = Math.max(1, cur - 1);

                        setQuantity(String(sItem.id), v);
                      }}
                    >
                      <Icons.minusLine className="size-6" />
                    </Button>

                    <Input
                      className="w-full text-center"
                      min={1}
                      radius="none"
                      size="lg"
                      type="number"
                      value={String(sItem.cantidad)}
                      variant="bordered"
                      onChange={(e) => {
                        const v = Number(
                          (e.target as HTMLInputElement).value || 1,
                        );

                        setQuantity(String(sItem.id), v >= 1 ? v : 1);
                      }}
                    />

                    <Button
                      isIconOnly
                      aria-label={`Aumentar cantidad ${sItem.id}`}
                      color="default"
                      variant="ghost"
                      onPress={() => {
                        const cur = Number(sItem.cantidad) || 1;
                        const v = cur + 1;

                        setQuantity(String(sItem.id), v);
                      }}
                    >
                      <Icons.addLine className="size-6" />
                    </Button>
                  </ButtonGroup>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
};
