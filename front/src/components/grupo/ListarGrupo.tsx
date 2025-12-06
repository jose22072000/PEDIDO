import type { Grupo } from "@/domain/catalogo";

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

import CrearGrupo from "./CrearGrupo";
import EditarGrupo from "./EditarGrupo";
import EliminarGrupo from "./EliminarGrupo";

import { cn } from "@/lib/utils";
import { useGrupoStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

type Props = {
  onSelect?: (id: string) => void;
  className?: string;
};

export default function GruposList({ onSelect, className = "" }: Props) {
  const { items, isLoading, error, loadAll } = useGrupoStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Grupo | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q)
      return items.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));

    return items.filter((g) => g.nombre.toLowerCase().includes(q));
  }, [items, query]);

  const handleSelect = (g: Grupo) => {
    setSelected(g);
    onOpen();
    onSelect && onSelect(g.id);
  };

  return (
    <div className={className}>
      {/* Tarjeta de filtro (misma estética que ProductFilter) */}
      <Card className={cn(cards({ border: true }), "mb-6")}>
        <CardBody className="p-0">
          <h3 className="text-lg font-bold mb-2">
            Filtra y presiona los grupos para ver los detalles
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
              <CrearGrupo />
            </div>
          </div>
          <p className="paragraph text-foreground">
            Grupos: {filtered.length} de {items.length}
          </p>
        </CardBody>
      </Card>

      {/* Estados / listado */}
      {isLoading ? (
        <Card>
          <CardBody>Cargando grupos...</CardBody>
        </Card>
      ) : error ? (
        <Card>
          <CardBody className="text-red-600">Error: {error}</CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>No se encontraron grupos.</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((g) => (
            <Card
              key={g.id}
              isPressable
              className={cards({ border: "primaryHover" })}
              onPress={() => handleSelect(g)}
            >
              <CardBody className="p-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-10 flex">
                      <Icons.tag className="size-10" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold leading-tight">
                        {g.nombre}
                      </div>
                      <Chip
                        color={g.activo ? "success" : "danger"}
                        size="sm"
                        variant="dot"
                      >
                        {g.activo ? "Activo" : "Inactivo"}
                      </Chip>
                    </div>
                  </div>
                  <div className="relative min-w-8">
                    <Tooltip content="Ver detalles">
                      <span>
                        <Icons.maximize className="size-8 text-primary" />
                      </span>
                    </Tooltip>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Drawer detalle (igual que en catálogo) */}
      <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <DrawerContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.tag className="size-12 text-primary" />
                <span className="heading">Grupo</span>
              </ModalHeader>
              <ModalBody className="gap-4 pb-6">
                {selected ? (
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-lg text-primary font-semibold">
                        NOMBRE
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.nombre}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-primary font-semibold">
                        Código
                      </div>
                      <div className="font-bold text-xl md:text-2xl">
                        {selected.codigo}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg text-primary font-semibold">
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
                  <div>No hay grupo seleccionado</div>
                )}
              </ModalBody>
              <DrawerFooter>
                {selected && (
                  <>
                    <EliminarGrupo
                      grupo={selected}
                      onDeleted={async (_id) => {
                        setSelected(null);
                        onClose();
                        await loadAll();
                      }}
                    />
                    <EditarGrupo
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
