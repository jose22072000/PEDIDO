import type { Proveedor } from "@/domain/producto";

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

import { useProveedorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  onCreated?: (p: Proveedor) => void;
};

export default function CrearProveedor({ className = "", onCreated }: Props) {
  const { create } = useProveedorStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [direccion, setDireccion] = useState("");
  const [activo, setActivo] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNombre("");
    setTelefono("");
    setCorreo("");
    setDireccion("");
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

    setIsSubmitting(true);
    try {
      const now = Date.now();
      const newItem: Proveedor = {
        id:
          typeof crypto !== "undefined" && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : String(now),
        nombre: nombre.trim(),
        telefono: telefono.trim() || undefined,
        correo: correo.trim() || undefined,
        direccion: direccion.trim() || undefined,
        activo,
        createdAt: now,
        updatedAt: now,
      } as Proveedor;

      await create(newItem);
      onCreated?.(newItem);
      onClose();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear proveedor");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("flex items-center", className)}>
      <Button
        className="btn"
        color="warning"
        size="lg"
        startContent={<Icons.add className="size-8" />}
        onPress={handleOpen}
      >
        Nuevo Proveedor
      </Button>

      <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <DrawerContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.users className="size-12 text-warning" />
                <span className="heading">Crear Proveedor</span>
              </ModalHeader>

              <ModalBody className="gap-4 pb-6">
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                  <Input
                    label="Nombre"
                    placeholder="Nombre del proveedor"
                    size="md"
                    value={nombre}
                    variant="bordered"
                    onValueChange={setNombre}
                  />

                  <Input
                    label="Teléfono"
                    placeholder="Teléfono"
                    size="md"
                    value={telefono}
                    variant="bordered"
                    onValueChange={setTelefono}
                  />

                  <Input
                    label="Correo"
                    placeholder="Correo electrónico"
                    size="md"
                    value={correo}
                    variant="bordered"
                    onValueChange={setCorreo}
                  />

                  <Input
                    label="Dirección"
                    placeholder="Dirección"
                    size="md"
                    value={direccion}
                    variant="bordered"
                    onValueChange={setDireccion}
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
                  color="warning"
                  isLoading={isSubmitting}
                  size="lg"
                  type="submit"
                  onPress={() => handleSubmit()}
                >
                  Guardar
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
