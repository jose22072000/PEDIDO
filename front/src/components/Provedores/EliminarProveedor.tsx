import type { Proveedor } from "@/domain/producto";

import { useState } from "react";
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  useDisclosure,
} from "@heroui/react";

import { useProveedorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

type Props = {
  proveedor: Proveedor;
  onDeleted?: (id: string) => void;
};

export default function EliminarProveedor({
  proveedor,
  onDeleted,
}: Props) {
  const { remove } = useProveedorStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setError(null);
    onOpen();
  };

  const handleDelete = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await remove(proveedor.id);
      onDeleted?.(proveedor.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al eliminar proveedor",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        className="btn w-full"
        color="danger"
        size="lg"
        startContent={<Icons.trash className="size-6" />}
        variant="bordered"
        onPress={handleOpen}
      >
        Eliminar
      </Button>

      <Modal
        backdrop="blur"
        isOpen={isOpen}
        placement="center"
        onOpenChange={onClose}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.trash className="size-10 text-danger mr-2" />
                <span className="heading">Eliminar Proveedor</span>
              </ModalHeader>

              <ModalBody className="gap-4 pb-6">
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="font-semibold text-lg mb-3">
                      ¿Eliminar {proveedor.nombre}?
                    </div>
                    <div className="text-sm text-foreground/70">
                      Esta acción es irreversible. Se eliminará el proveedor y
                      sus referencias en la aplicación local (si corresponde).
                    </div>
                  </div>

                  {error && <div className="text-red-600">{error}</div>}

                  <div className="flex gap-4 justify-center mt-4">
                    <Button
                      disabled={isSubmitting}
                      size="lg"
                      variant="ghost"
                      onPress={onClose}
                    >
                      Cancelar
                    </Button>
                    <Button
                      color="danger"
                      disabled={isSubmitting}
                      isLoading={isSubmitting}
                      size="lg"
                      startContent={<Icons.checkLine className="size-5" />}
                      variant="shadow"
                      onPress={handleDelete}
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
