import {
  Card,
  CardBody,
  Select,
  SelectItem,
  Button,
  Spinner,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import Icons from "../icons/iconify";

import { cards } from "@/components/primitives";
import { API_BASE_URL } from "@/config";

interface Sucursal {
  id: string;
  nombre: string;
}

interface Config {
  sucursalId: string | null;
}

interface SucursalFormData {
  nombre: string;
}

export const ConfiguracionForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [selectedSucursal, setSelectedSucursal] = useState<string>("");
  const [config, setConfig] = useState<Config | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors },
    reset,
  } = useForm<SucursalFormData>();

  useEffect(() => {
    fetchConfig();
    fetchSucursales();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/config`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();

        setConfig(data);

        if (data.sucursalId) {
          setSelectedSucursal(data.sucursalId);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar configuración",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSucursales = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sucursales`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();

        setSucursales(data);
      }
    } catch (err) {
      // Error fetching sucursales
    }
  };

  const handleSave = async () => {
    if (!selectedSucursal) {
      setError("Debe seleccionar una sucursal");

      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          sucursalId: selectedSucursal,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al guardar configuración");
      }

      setSuccess("Configuración guardada correctamente");
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSaving(false);
    }
  };

  const onSubmitSucursal = async (data: SucursalFormData) => {
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/sucursales`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al crear sucursal");
      }

      setSuccess("Sucursal creada correctamente");
      reset();
      onClose();
      fetchSucursales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner color="primary" size="lg" />
      </div>
    );
  }

  return (
    <Card className={cards()}>
      <CardBody>
        <div className="flex flex-col gap-4">
          {error && (
            <div className="bg-danger-50 border-l-4 border-danger p-4 rounded">
              <div className="flex items-center gap-2">
                <Icons.close className="size-5 text-danger" />
                <p className="text-sm text-danger-700">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-success-50 border-l-4 border-success p-4 rounded">
              <div className="flex items-center gap-2">
                <Icons.check className="size-5 text-success" />
                <p className="text-sm text-success-700">{success}</p>
              </div>
            </div>
          )}

          <div className="bg-default-100 p-4 rounded-lg">
            <p className="text-sm text-default-600 flex items-center gap-2">
              <span className="text-lg">ℹ️</span>
              <span>
                La sucursal seleccionada determinará qué datos se mostrarán en
                este sistema.
              </span>
            </p>
          </div>

          {sucursales.length === 0 ? (
            <div className="bg-warning-50 border-l-4 border-warning p-4 rounded">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚠️</span>
                  <p className="text-sm text-warning-700">
                    No hay sucursales registradas en el sistema.
                  </p>
                </div>
                <Button
                  className="w-fit"
                  color="primary"
                  size="sm"
                  startContent={<Icons.add className="size-4" />}
                  onPress={onOpen}
                >
                  Crear Sucursal
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Select
                label="Sucursal del Sistema"
                placeholder="Seleccione una sucursal"
                selectedKeys={selectedSucursal ? [selectedSucursal] : []}
                variant="bordered"
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;

                  setSelectedSucursal(selected);
                }}
              >
                {sucursales.map((sucursal) => (
                  <SelectItem key={sucursal.id}>{sucursal.nombre}</SelectItem>
                ))}
              </Select>

              {config?.sucursalId && (
                <div className="bg-success-50 p-3 rounded-lg">
                  <p className="text-sm text-success-700 flex items-center gap-2">
                    <Icons.check className="size-4" />
                    <span>
                      Sucursal actual configurada:{" "}
                      <strong>
                        {sucursales.find((s) => s.id === config.sucursalId)
                          ?.nombre || "Desconocida"}
                      </strong>
                    </span>
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 justify-between">
            {sucursales.length > 0 && (
              <Button
                color="default"
                size="sm"
                startContent={<Icons.add className="size-4" />}
                variant="flat"
                onPress={onOpen}
              >
                Agregar Sucursal
              </Button>
            )}
            <Button
              className="ml-auto"
              color="primary"
              isDisabled={!selectedSucursal}
              isLoading={isSaving}
              onPress={handleSave}
            >
              Guardar Configuración
            </Button>
          </div>
        </div>
      </CardBody>

      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        onClose={onClose}
      >
        <ModalContent>
          <form onSubmit={handleSubmit(onSubmitSucursal)}>
            <ModalHeader>Crear Nueva Sucursal</ModalHeader>
            <ModalBody>
              <Input
                {...register("nombre", {
                  required: "El nombre es requerido",
                  minLength: {
                    value: 3,
                    message: "Mínimo 3 caracteres",
                  },
                })}
                errorMessage={formErrors.nombre?.message}
                isInvalid={!!formErrors.nombre}
                label="Nombre de la Sucursal"
                placeholder="Ej: Sucursal Centro"
              />
            </ModalBody>
            <ModalFooter>
              <Button color="danger" variant="flat" onPress={onClose}>
                Cancelar
              </Button>
              <Button color="primary" isLoading={isCreating} type="submit">
                Crear
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </Card>
  );
};
