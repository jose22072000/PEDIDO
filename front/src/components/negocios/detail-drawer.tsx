import { useState } from "react";
import { Drawer, DrawerContent, ModalBody, ModalHeader } from "@heroui/react";

import useNegocioCatalogStore from "@/stores/negocioCatalogStore";
import { useTrabajadorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

export const useNegocioDetail = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const catalog = useNegocioCatalogStore((s) => s.items);

  const negocio = catalog.find((n) => n.id === selectedId);
  const trabajadores = useTrabajadorStore((s) => s.items);
  const assigned = negocio
    ? trabajadores.find((t) => t.email === negocio.trabajadorAsignado)
    : undefined;

  const modal = (
    <Drawer backdrop="blur" isOpen={isOpen} onClose={() => setIsOpen(false)}>
      <DrawerContent>
        {() => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <Icons.store className="size-12 text-warning" />
              <span className="heading">Negocio</span>
            </ModalHeader>
            <ModalBody className="gap-4 pb-6">
              {negocio ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="text-lg text-warning font-semibold">
                      NOMBRE
                    </div>
                    <h3 className="font-bold text-xl md:text-2xl">
                      {negocio.nombre}
                    </h3>
                  </div>
                  <div>
                    <div className="text-sm text-default-500">Dirección</div>
                    <div className="font-semibold">
                      {negocio.direccion || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-default-500">Alias</div>
                    <div className="font-semibold">{negocio.alias || "-"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-default-500">Asignado a</div>
                    <div className="font-semibold">
                      {assigned ? assigned.nombre : "Sin asignar"}
                    </div>
                  </div>
                  {negocio.descripcion && (
                    <div>
                      <div className="text-sm text-default-500">
                        Descripción
                      </div>
                      <p className="text-default-600 mt-1">
                        {negocio.descripcion}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>No se ha seleccionado ningún negocio</div>
              )}
            </ModalBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );

  const onPressAction = (id?: string) => {
    setSelectedId(id);
    setIsOpen(true);
  };

  return { modal, onPressAction };
};

export default useNegocioDetail;
