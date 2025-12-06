// ...existing code...
import type { Grupo } from "@/domain/catalogo";

import { useState } from "react";
import {
  Button,
  Drawer,
  DrawerContent,
  ModalHeader,
  ModalBody,
  Input,
  useDisclosure,
  DrawerFooter,
} from "@heroui/react";

import { useGrupoStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  onCreated?: (g: Grupo) => void;
};

export default function CrearGrupo({ className = "", onCreated }: Props) {
  const { create } = useGrupoStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [activo, setActivo] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNombre("");
    setCodigo("");
    setActivo(true);
    setError(null);
  };

  const handleOpen = () => {
    reset();
    onOpen();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    setError(null);

    if (!nombre.trim()) {
      setError("El nombre es requerido.");

      return;
    }
    if (!codigo.trim()) {
      setError("El código es requerido.");

      return;
    }

    setIsSubmitting(true);
    try {
      const now = Date.now();
      const newItem: Grupo = {
        id:
          typeof crypto !== "undefined" && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : String(now),
        nombre: nombre.trim(),
        codigo: codigo.trim(),
        activo,
        createdAt: now,
        updatedAt: now,
      };

      await create(newItem);
      onCreated?.(newItem);
      onClose();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear grupo");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("flex items-center", className)}>
      <Button
        className="btn"
        color="primary"
        size="lg"
        startContent={<Icons.add className="size-8" />}
        onPress={handleOpen}
      >
        Nuevo Grupo
      </Button>

      <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <DrawerContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.tag className="size-12 text-primary" />
                <span className="heading">Crear Grupo</span>
              </ModalHeader>

              <ModalBody className="gap-4 pb-6">
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                  <Input
                    label="Nombre"
                    placeholder="Nombre del grupo"
                    size="md"
                    value={nombre}
                    variant="bordered"
                    onValueChange={setNombre}
                  />

                  <Input
                    label="Código"
                    placeholder="Código interno"
                    size="md"
                    value={codigo}
                    variant="bordered"
                    onValueChange={setCodigo}
                  />

                  <label className="flex items-center gap-2">
                    <input
                      checked={activo}
                      className="form-checkbox"
                      type="checkbox"
                      onChange={(ev) => setActivo(ev.target.checked)}
                    />
                    <span>Activo</span>
                  </label>

                  {error && <div className="text-red-600">{error}</div>}
                </form>
              </ModalBody>
              <DrawerFooter>
                <Button
                  className="btn w-full"
                  disabled={isSubmitting}
                  size="lg"
                  variant="ghost"
                  onPress={onClose}
                >
                  Cancelar
                </Button>
                <Button
                  className="btn w-full"
                  color="primary"
                  isLoading={isSubmitting}
                  size="lg"
                  type="submit"
                  onPress={() => handleSubmit()}
                >
                  Crear Grupo
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
