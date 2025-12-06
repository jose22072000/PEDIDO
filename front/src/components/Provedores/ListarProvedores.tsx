import type { Proveedor } from "@/domain/producto";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardBody,
  Input,
  Drawer,
  DrawerContent,
  ModalHeader,
  ModalBody,
  Chip,
  Tooltip,
  useDisclosure,
  DrawerFooter,
} from "@heroui/react";

import { cards } from "../primitives";

import CrearProveedor from "./CrearProveedor";
import EditarProveedor from "./EditarProveedor";
import EliminarProveedor from "./EliminarProveedor";

import { cn } from "@/lib/utils";
import { useProveedorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

type Props = {
  onSelect?: (id: string) => void;
  className?: string;
};

export default function ListarProvedores({ onSelect, className = "" }: Props) {
  const { items, isLoading, error, loadAll } = useProveedorStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Proveedor | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q)
      return items.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));

    return items.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [items, query]);

  const handleSelect = (p: Proveedor) => {
    setSelected(p);
    onOpen();
    onSelect && onSelect(p.id);
  };

  return (
    <div className={className}>
      <Card className={cn(cards({ border: true }), "mb-6")}>
        <CardBody className="p-0">
          <h3 className="text-lg font-bold mb-2">
            Filtra y presiona los proveedores para ver los detalles
          </h3>

          <div className="flex flex-col md:flex-row gap-4 mb-2">
            <Input
              isClearable
              className="w-full"
              label="Buscar"
              placeholder="Filtrar por nombre"
              size="lg"
              value={query}
              variant="bordered"
              onValueChange={setQuery}
            />
            <div className="w-full md:flex-1 flex">
              <CrearProveedor />
            </div>
          </div>
          <p className="paragraph text-foreground">
            Proveedores: {filtered.length} de {items.length}
          </p>
        </CardBody>
      </Card>

      {isLoading ? (
        <Card>
          <CardBody>Cargando proveedores...</CardBody>
        </Card>
      ) : error ? (
        <Card>
          <CardBody className="text-red-600">Error: {error}</CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>No se encontraron proveedores.</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <Card
              key={p.id}
              isPressable
              className={cards({ border: "warningHover" })}
              onPress={() => handleSelect(p)}
            >
              <CardBody className="p-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-10 flex">
                      <Icons.partners className="size-10" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold leading-tight">
                        {p.nombre}
                      </div>
                      <div className="text-sm text-foreground/70">
                        {p.correo}
                      </div>
                      <Chip
                        color={p.activo ? "success" : "danger"}
                        size="sm"
                        variant="dot"
                      >
                        {p.activo ? "Activo" : "Inactivo"}
                      </Chip>
                    </div>
                  </div>
                  <div className="relative min-w-8">
                    <Tooltip content="Ver detalles">
                      <span>
                        <Icons.maximize className="size-8 text-warning" />
                      </span>
                    </Tooltip>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <DrawerContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.users className="size-12 text-warning mr-2" />
                <span className="heading">Proveedor</span>
              </ModalHeader>
              <ModalBody className="gap-4 pb-6">
                {selected ? (
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-lg text-warning font-semibold">
                        NOMBRE
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.nombre}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-warning font-semibold">
                        Correo
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.correo || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-warning font-semibold">
                        Teléfono
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.telefono || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-warning font-semibold">
                        Dirección
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.direccion || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-warning font-semibold">
                        Estado
                      </div>
                      <div className="mt-1">
                        <Chip
                          color={selected.activo ? "success" : "danger"}
                          variant="dot"
                        >
                          {selected.activo ? "Activo" : "Inactivo"}
                        </Chip>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>No hay proveedor seleccionado</div>
                )}
              </ModalBody>
              <DrawerFooter>
                {selected && (
                  <>
                    <EliminarProveedor
                      proveedor={selected}
                      onDeleted={async (_id) => {
                        setSelected(null);
                        onClose();
                        await loadAll();
                      }}
                    />
                    <EditarProveedor
                      item={selected}
                      onUpdated={(u) => {
                        setSelected(u);
                      }}
                    />
                  </>
                )}
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
