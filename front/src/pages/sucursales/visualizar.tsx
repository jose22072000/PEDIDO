import { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardBody,
  Autocomplete,
  AutocompleteItem,
  Button,
  Chip,
  Divider,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Input,
  Switch,
} from "@heroui/react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { NavigationHeading } from "@/components/navigation-heading";
import { useSucursalStore } from "@/stores/entityStores";
import { useAuthStore } from "@/stores/authStore";
import Icons from "@/components/icons/iconify";

const EditSucursalSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  codigo: z.string().min(1, "El código es requerido"),
  ciudad: z.string().min(1, "La ciudad es requerida"),
  direccion: z.string().optional(),
  activo: z.boolean(),
});

type EditSucursalForm = z.infer<typeof EditSucursalSchema>;

export default function VisualizarSucursalPage() {
  const session = useAuthStore((state) => state.session);
  const {
    items: sucursales,
    loadAll,
    update: updateSucursal,
    remove: removeSucursal,
  } = useSucursalStore();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  // Verificar permisos administrativos
  const isAdmin = session?.rol === "ADMIN" || session?.rol === "DIRECTIVO";

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selectedSucursal = useMemo(() => {
    if (!selectedKey) return null;

    return sucursales.find((s) => s.id === selectedKey) || null;
  }, [selectedKey, sucursales]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditSucursalForm>({
    resolver: zodResolver(EditSucursalSchema),
  });

  const handleEdit = () => {
    if (!selectedSucursal) return;
    reset({
      nombre: selectedSucursal.nombre,
      codigo: selectedSucursal.codigo,
      ciudad: selectedSucursal.ciudad,
      direccion: selectedSucursal.direccion || "",
      activo: selectedSucursal.activo,
    });
    onEditOpen();
  };

  const onSubmitEdit = async (data: EditSucursalForm) => {
    if (!selectedSucursal || !isAdmin) return;

    try {
      await updateSucursal(selectedSucursal.id, data);
      onEditClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error al actualizar sucursal:", error);
    }
  };

  const handleDelete = async () => {
    if (!selectedSucursal || !isAdmin) return;

    setIsDeleting(true);
    try {
      await removeSucursal(selectedSucursal.id);
      setSelectedKey(null);
      onDeleteClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error al eliminar sucursal:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="flex flex-col gap-6 p-4">
      <NavigationHeading
        cta={{ href: "/panel/panel-sucursal", label: "Volver a Sucursales" }}
        icon="eye"
        paragraph="Selecciona una sucursal para ver sus detalles"
        title="Visualizar Sucursales"
      />

      <Card>
        <CardBody className="gap-4">
          <Autocomplete
            label="Buscar sucursal"
            placeholder="Escribe para buscar..."
            selectedKey={selectedKey}
            variant="bordered"
            onSelectionChange={(key) => setSelectedKey(key as string)}
          >
            {sucursales.map((sucursal) => (
              <AutocompleteItem key={sucursal.id} textValue={sucursal.nombre}>
                <div className="flex flex-col">
                  <span className="font-semibold">{sucursal.nombre}</span>
                  <span className="text-sm text-default-500">
                    {sucursal.codigo} - {sucursal.ciudad}
                  </span>
                </div>
              </AutocompleteItem>
            ))}
          </Autocomplete>

          {selectedSucursal && (
            <>
              <Divider />

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold">
                    {selectedSucursal.nombre}
                  </h3>
                  <Chip
                    color={selectedSucursal.activo ? "success" : "danger"}
                    variant="flat"
                  >
                    {selectedSucursal.activo ? "Activa" : "Inactiva"}
                  </Chip>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-default-500">Código</span>
                    <span className="font-semibold">
                      {selectedSucursal.codigo}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-default-500">Ciudad</span>
                    <span className="font-semibold">
                      {selectedSucursal.ciudad}
                    </span>
                  </div>

                  {selectedSucursal.direccion && (
                    <div className="flex flex-col gap-2 md:col-span-2">
                      <span className="text-sm text-default-500">
                        Dirección
                      </span>
                      <span className="font-semibold">
                        {selectedSucursal.direccion}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-default-500">
                      Fecha de creación
                    </span>
                    <span className="font-semibold">
                      {new Date(selectedSucursal.createdAt).toLocaleDateString(
                        "es-ES",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-default-500">
                      Última actualización
                    </span>
                    <span className="font-semibold">
                      {new Date(selectedSucursal.updatedAt).toLocaleDateString(
                        "es-ES",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </span>
                  </div>
                </div>

                {isAdmin && (
                  <>
                    <Divider />
                    <div className="flex gap-4 justify-end">
                      <Button
                        color="warning"
                        startContent={<Icons.edit className="size-5" />}
                        variant="flat"
                        onPress={handleEdit}
                      >
                        Editar
                      </Button>
                      <Button
                        color="danger"
                        startContent={<Icons.delete className="size-5" />}
                        variant="flat"
                        onPress={onDeleteOpen}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {!selectedSucursal && (
            <div className="flex flex-col items-center justify-center py-12 text-default-500">
              <Icons.building className="size-16 mb-4 opacity-50" />
              <p>Selecciona una sucursal para ver sus detalles</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Modal de Edición */}
      <Modal isOpen={isEditOpen} size="2xl" onClose={onEditClose}>
        <ModalContent>
          <form onSubmit={handleSubmit(onSubmitEdit)}>
            <ModalHeader>Editar Sucursal</ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-4">
                <Controller
                  control={control}
                  name="nombre"
                  render={({ field }) => (
                    <Input
                      {...field}
                      isRequired
                      errorMessage={errors.nombre?.message}
                      isInvalid={!!errors.nombre}
                      label="Nombre"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="codigo"
                  render={({ field }) => (
                    <Input
                      {...field}
                      isRequired
                      errorMessage={errors.codigo?.message}
                      isInvalid={!!errors.codigo}
                      label="Código"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="ciudad"
                  render={({ field }) => (
                    <Input
                      {...field}
                      isRequired
                      errorMessage={errors.ciudad?.message}
                      isInvalid={!!errors.ciudad}
                      label="Ciudad"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="direccion"
                  render={({ field }) => (
                    <Input
                      {...field}
                      errorMessage={errors.direccion?.message}
                      isInvalid={!!errors.direccion}
                      label="Dirección"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="activo"
                  render={({ field }) => (
                    <Switch
                      isSelected={field.value}
                      onValueChange={field.onChange}
                    >
                      Sucursal activa
                    </Switch>
                  )}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button color="default" variant="flat" onPress={onEditClose}>
                Cancelar
              </Button>
              <Button color="warning" isLoading={isSubmitting} type="submit">
                Guardar Cambios
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Modal de Confirmación de Eliminación */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader>Confirmar Eliminación</ModalHeader>
          <ModalBody>
            <p>
              ¿Estás seguro de que deseas eliminar la sucursal{" "}
              <strong>{selectedSucursal?.nombre}</strong>?
            </p>
            <p className="text-sm text-danger">
              Esta acción no se puede deshacer.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="flat" onPress={onDeleteClose}>
              Cancelar
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={handleDelete}
            >
              Eliminar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}
