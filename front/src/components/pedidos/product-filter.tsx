import { Card, CardBody, Chip, Input, Select, SelectItem } from "@heroui/react";

import { cards } from "../primitives";

import { useProductCatalogStore } from "@/stores/productCatalogStore";

export const PedidoProductFilter = () => {
  const grupos = useProductCatalogStore((s) => s.grupos);
  const proveedores = useProductCatalogStore((s) => s.proveedores);
  const filter = useProductCatalogStore((s) => s.filter);
  const setFilter = useProductCatalogStore((s) => s.setFilter);
  const filterGrupos = useProductCatalogStore((s) => s.filterGrupos);
  const filterProveedores = useProductCatalogStore((s) => s.filterProveedores);
  const filterCategorias = useProductCatalogStore((s) => s.filterCategorias);
  const setFilterGrupos = useProductCatalogStore((s) => s.setFilterGrupos);
  const setFilterProveedores = useProductCatalogStore(
    (s) => s.setFilterProveedores,
  );
  const setFilterCategorias = useProductCatalogStore(
    (s) => s.setFilterCategorias,
  );
  const items = useProductCatalogStore((s) => s.items);
  const filteredCount = useProductCatalogStore((s) => s.getFilteredCount());

  const totalItems = items.length;

  return (
    <Card className={cards({ border: true })}>
      <CardBody className="gap-4 p-0">
        <h3 className="text-lg font-bold">Filtra y selecciona los productos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            isMultiline
            classNames={{
              trigger: "min-h-12 py-2",
            }}
            label="Grupos"
            placeholder="Seleccionar grupos"
            renderValue={(items) => {
              return (
                <div className="flex flex-wrap gap-1">
                  {items.map((item) => (
                    <Chip
                      key={item.key}
                      color="primary"
                      size="sm"
                      variant="flat"
                    >
                      {item.textValue}
                    </Chip>
                  ))}
                </div>
              );
            }}
            selectedKeys={filterGrupos}
            selectionMode="multiple"
            size="lg"
            variant="bordered"
            onSelectionChange={(keys) => setFilterGrupos(keys as Set<string>)}
          >
            {grupos.map((grupo) => (
              <SelectItem key={grupo.id}>{grupo.nombre}</SelectItem>
            ))}
          </Select>
          <Select
            isMultiline
            classNames={{
              trigger: "min-h-12 py-2",
            }}
            label="Proveedores"
            placeholder="Seleccionar proveedores"
            renderValue={(items) => {
              return (
                <div className="flex flex-wrap gap-1">
                  {items.map((item) => (
                    <Chip
                      key={item.key}
                      color="secondary"
                      size="sm"
                      variant="flat"
                    >
                      {item.textValue}
                    </Chip>
                  ))}
                </div>
              );
            }}
            selectedKeys={filterProveedores}
            selectionMode="multiple"
            size="lg"
            variant="bordered"
            onSelectionChange={(keys) =>
              setFilterProveedores(keys as Set<string>)
            }
          >
            {proveedores.map((proveedor) => (
              <SelectItem key={proveedor.id}>{proveedor.nombre}</SelectItem>
            ))}
          </Select>
        </div>
        <Input
          isClearable
          className="md:col-span-2"
          label="Buscar"
          placeholder="Buscar productos..."
          size="lg"
          value={filter}
          variant="bordered"
          onValueChange={setFilter}
        />
        {/* Resumen de filtros aplicados */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="paragraph text-foreground">
            Productos: {filteredCount} de {totalItems}
          </span>
          {
            /* no categorias here */ (filterCategorias.size > 0 ||
              filterGrupos.size > 0 ||
              filterProveedores.size > 0 ||
              !!filter) && (
              <Chip
                className="cursor-pointer"
                size="sm"
                variant="flat"
                onClick={() => {
                  setFilter("");
                  setFilterCategorias(new Set());
                  setFilterGrupos(new Set());
                  setFilterProveedores(new Set());
                }}
                onClose={() => {
                  setFilter("");
                  setFilterCategorias(new Set());
                  setFilterGrupos(new Set());
                  setFilterProveedores(new Set());
                }}
              >
                Limpiar filtros
              </Chip>
            )
          }
        </div>
      </CardBody>
    </Card>
  );
};
