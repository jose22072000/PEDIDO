import {
  Card,
  CardBody,
  Chip,
  Drawer,
  DrawerContent,
  ModalBody,
  ModalHeader,
  Pagination,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import Icons from "../icons/iconify";
import { cards } from "../primitives";

import { useProductCatalogStore } from "@/stores/productCatalogStore";

export const useProductDetail = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedId, setSelectedId] = useState<string | number | undefined>(
    undefined,
  );
  const catalogo = useProductCatalogStore((s) => s.items);
  const productoConRelaciones = catalogo.find((p) => p.id === selectedId);
  const modal = (
    <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
      <DrawerContent>
        {() => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <Icons.product className="size-12 text-primary" />
              <span className="heading">Producto</span>
            </ModalHeader>
            <ModalBody className="gap-4 pb-6">
              {productoConRelaciones ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="text-lg text-primary font-semibold">
                      NOMBRE
                    </div>
                    <h3 className="font-bold text-xl md:text-2xl">
                      {productoConRelaciones.nombre}
                    </h3>
                  </div>
                  <div>
                    <div className="text-lg text-primary font-semibold">
                      SKU
                    </div>
                    <h3 className="font-bold text-xl md:text-2xl">
                      {productoConRelaciones.sku || "-"}
                    </h3>
                  </div>
                  <div>
                    <div className="text-lg text-primary font-semibold">
                      GRUPO
                    </div>
                    <h3 className="font-bold text-xl md:text-2xl">
                      {productoConRelaciones.grupoNombre || "-"}
                    </h3>
                  </div>
                  <div>
                    <div className="text-lg text-primary font-semibold">
                      PROVEEDOR
                    </div>
                    <h3 className="font-bold text-xl md:text-2xl">
                      {productoConRelaciones.proveedorNombre || "-"}
                    </h3>
                  </div>
                  <div>
                    <div className="text-lg text-primary font-semibold mb-2">
                      ESTADO
                    </div>
                    <Chip
                      color={
                        productoConRelaciones.activo ? "success" : "danger"
                      }
                      size="lg"
                      variant="dot"
                    >
                      {productoConRelaciones.activo ? "Activo" : "Inactivo"}
                    </Chip>
                  </div>
                  {productoConRelaciones.descripcion && (
                    <div>
                      <div className="text-sm text-default-500">
                        Descripción
                      </div>
                      <p className="text-default-600 mt-1">
                        {productoConRelaciones.descripcion}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>No se ha seleccionado ningún producto</div>
              )}
            </ModalBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );

  const onPressAction = (id?: string | number) => {
    setSelectedId(id);
    onOpen();
  };

  return {
    modal,
    onPressAction,
  };
};

export const CatalogoList = ({
  pressAction,
  cardIcon = "maximize",
}: {
  pressAction?: (id?: string | number) => void;
  cardIcon?: keyof typeof Icons | string;
}) => {
  const CardIconComp: React.ComponentType<any> =
    (Icons as any)[cardIcon] ?? (Icons as any)["maximize"] ?? (() => null);
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

  // Paginación
  const [page, setPage] = useState<number>(1);
  const pageSize = 9; // elementos por página (3 columnas x 3 filas)
  const totalPages = Math.max(1, Math.ceil(catalogo.length / pageSize));
  const pagedCatalog = useMemo(() => {
    const start = (page - 1) * pageSize;

    return catalogo.slice(start, start + pageSize);
  }, [catalogo, page]);

  // Resetear página cuando cambian filtros o búsqueda
  useEffect(() => {
    setPage(1);
  }, [filter, filterCategorias, filterGrupos, filterProveedores]);

  // Resolve dynamic icon component from Icons map

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pagedCatalog.map((producto) => (
          <Card
            key={producto.id}
            isPressable
            className={cards({ border: "primaryHover" })}
            onPress={() => pressAction && pressAction(producto.id)}
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
                    <Tooltip content="Ver detalles">
                      <CardIconComp className="size-8 text-primary" />
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
        <div className="flex w-full justify-center pt-12">
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
