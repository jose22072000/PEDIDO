import type { Proveedor } from "@/domain/producto";

import { useEffect, useState } from "react";
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

type Props = {
  item: Proveedor | null;
  onUpdated?: (p: Proveedor) => void;
};

export default function EditarProveedor({
  item,
  onUpdated,
}: Props) {
  const { update } = useProveedorStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [nombre, setNombre] = useState(item?.nombre || "");
  const [telefono, setTelefono] = useState(item?.telefono || "");
  const [correo, setCorreo] = useState(item?.correo || "");
  const [direccion, setDireccion] = useState(item?.direccion || "");
  const [activo, setActivo] = useState(item?.activo || false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setNombre(item.nombre);
    setTelefono(item.telefono || "");
    setCorreo(item.correo || "");
    setDireccion(item.direccion || "");
    setActivo(item.activo);
  }, [item]);

  const handleOpen = () => {
    setError(null);
    if (!item) return;
    setNombre(item.nombre);
    setTelefono(item.telefono || "");
    setCorreo(item.correo || "");
    setDireccion(item.direccion || "");
    setActivo(item.activo);
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
      if (!item) {
        setError("No hay proveedor seleccionado");
        setIsSubmitting(false);

        return;
      }

      const updates: Partial<Proveedor> = {
        nombre: nombre.trim(),
        telefono: telefono.trim() || undefined,
        correo: correo.trim() || undefined,
        direccion: direccion.trim() || undefined,
        activo,
      };

      await update(item.id, updates);

      const updated: Proveedor = {
        ...item,
        ...updates,
        updatedAt: Date.now(),
      } as Proveedor;

      onUpdated?.(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al actualizar proveedor",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        className="btn w-full"
        color="warning"
        size="lg"
        startContent={<Icons.edit className="size-6" />}
        onPress={handleOpen}
      >
        Editar
      </Button>

      <Drawer backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <DrawerContent>
          {() => (
            <>
              <ModalHeader>
                <Icons.users className="size-12 text-warning" />
                <span className="heading">Editar Proveedor</span>
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
    </>
  );
}
