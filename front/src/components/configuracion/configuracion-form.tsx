import {
  Card,
  CardBody,
  Button,
  Spinner,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import { useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { cards } from "@/components/primitives";
import { getApiBaseUrl } from "@/config";

export const ConfiguracionForm = () => {
  const [sucursales, setSucursales] = useState<
    Array<{ id: string; nombre: string; codigo?: string | null }>
  >([]);
  const [isLoadingSucursales, setIsLoadingSucursales] = useState(false);
  const [isCreatingSucursal, setIsCreatingSucursal] = useState(false);
  const [isUpdatingSucursal, setIsUpdatingSucursal] = useState(false);
  const [isDeletingSucursal, setIsDeletingSucursal] = useState(false);
  const [newSucursalName, setNewSucursalName] = useState("");
  const [newSucursalCodigo, setNewSucursalCodigo] = useState("");
  const [editSucursalName, setEditSucursalName] = useState("");
  const [editSucursalCodigo, setEditSucursalCodigo] = useState("");
  const [selectedSucursalId, setSelectedSucursalId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const {
    isOpen: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();
  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteSucursalOpen,
    onOpen: onDeleteSucursalOpen,
    onClose: onDeleteSucursalClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  useEffect(() => {
    fetchSucursales();
  }, []);

  const fetchSucursales = async () => {
    setIsLoadingSucursales(true);

    try {
      const response = await fetch(`${getApiBaseUrl()}/sucursales`);

      if (!response.ok) {
        throw new Error("Error al cargar las sucursales");
      }

      const data = await response.json();

      setSucursales(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoadingSucursales(false);
    }
  };

  const handleCreateSucursal = async () => {
    const nombre = newSucursalName.trim();

    if (!nombre) {
      setError("El nombre de la sucursal es requerido");

      return;
    }

    setIsCreatingSucursal(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/sucursales`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nombre, codigo: newSucursalCodigo.trim() || null }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al crear la sucursal");
      }

      setSuccess("Sucursal creada correctamente");
      setNewSucursalName("");
      setNewSucursalCodigo("");
      onCreateClose();
      fetchSucursales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsCreatingSucursal(false);
    }
  };

  const openEditSucursal = (sucursal: {
    id: string;
    nombre: string;
    codigo?: string | null;
  }) => {
    setSelectedSucursalId(sucursal.id);
    setEditSucursalName(sucursal.nombre);
    setEditSucursalCodigo(sucursal.codigo ?? "");
    onEditOpen();
  };

  const handleEditSucursal = async () => {
    const nombre = editSucursalName.trim();

    if (!selectedSucursalId) {
      return;
    }

    if (!nombre) {
      setError("El nombre de la sucursal es requerido");

      return;
    }

    setIsUpdatingSucursal(true);
    setError(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/sucursales/${selectedSucursalId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nombre, codigo: editSucursalCodigo.trim() || null }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al editar la sucursal");
      }

      setSuccess("Sucursal editada correctamente");
      onEditClose();
      setSelectedSucursalId(null);
      setEditSucursalName("");
      setEditSucursalCodigo("");
      fetchSucursales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsUpdatingSucursal(false);
    }
  };

  const openDeleteSucursal = (sucursalId: string) => {
    setSelectedSucursalId(sucursalId);
    onDeleteSucursalOpen();
  };

  const handleDeleteSucursal = async () => {
    if (!selectedSucursalId) {
      return;
    }

    setIsDeletingSucursal(true);
    setError(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/sucursales/${selectedSucursalId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al eliminar la sucursal");
      }

      setSuccess("Sucursal eliminada correctamente");
      onDeleteSucursalClose();
      setSelectedSucursalId(null);
      fetchSucursales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsDeletingSucursal(false);
    }
  };

  const handleDeleteDatabase = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/config/reset-database`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al borrar la base de datos");
      }

      setSuccess("Base de datos borrada correctamente");
      onDeleteClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
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
              <p className="text-sm text-default-700">
                La sucursal activa se asigna automaticamente por usuario.
                Aqui solo se gestionan sucursales del sistema.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-primary">
                Gestion de Sucursales
              </h3>
              <Button
                color="primary"
                startContent={<Icons.add className="size-4" />}
                onPress={onCreateOpen}
              >
                Nueva Sucursal
              </Button>
            </div>

            {isLoadingSucursales ? (
              <div className="flex justify-center p-8">
                <Spinner color="primary" size="lg" />
              </div>
            ) : (
              <Table
                aria-label="Tabla de sucursales"
                classNames={{
                  th: "bg-primary text-white text-sm font-bold",
                  tr: "hover:bg-primary/5 transition-colors",
                  td: "align-middle text-sm",
                }}
              >
                <TableHeader>
                  <TableColumn>NOMBRE</TableColumn>
                  <TableColumn>CÓDIGO</TableColumn>
                  <TableColumn className="text-right">ACCIONES</TableColumn>
                </TableHeader>
                <TableBody emptyContent="No hay sucursales registradas">
                  {sucursales.map((sucursal) => (
                    <TableRow key={sucursal.id}>
                      <TableCell className="font-bold text-medium text-primary">
                        {sucursal.nombre}
                      </TableCell>
                      <TableCell>
                        {sucursal.codigo ? (
                          <Chip color="primary" size="sm" variant="flat">
                            {sucursal.codigo}
                          </Chip>
                        ) : (
                          <Chip color="warning" size="sm" variant="flat">
                            sin código
                          </Chip>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            color="primary"
                            isIconOnly
                            size="sm"
                            variant="flat"
                            aria-label="Editar sucursal"
                            onPress={() => openEditSucursal(sucursal)}
                          >
                            <Icons.edit className="size-4" />
                          </Button>
                          <Button
                            color="danger"
                            isIconOnly
                            size="sm"
                            variant="flat"
                            aria-label="Eliminar sucursal"
                            onPress={() => openDeleteSucursal(sucursal.id)}
                          >
                            <Icons.trash className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Card de Zona de Peligro */}
      <Card className={cards()}>
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-semibold text-danger">
                Zona de Peligro (Solo Administrador)
              </h3>
            </div>

            <div className="bg-danger-50 border border-danger-200 p-4 rounded-lg">
              <p className="text-sm text-danger-700 mb-3">
                <strong>Borrar Base de Datos:</strong> Esta acción eliminará
                permanentemente todos los datos del sistema incluyendo pedidos,
                clientes, vendedores y configuraciones.
              </p>
              <Button
                color="danger"
                startContent={<Icons.close className="size-4" />}
                variant="flat"
                onPress={onDeleteOpen}
              >
                Borrar Base de Datos
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Modal crear sucursal */}
      <Modal isOpen={isCreateOpen} placement="center" onClose={onCreateClose}>
        <ModalContent>
          <ModalHeader>Crear Sucursal</ModalHeader>
          <ModalBody>
            <Input
              label="Nombre"
              placeholder="Ej: Las Tunas"
              value={newSucursalName}
              onValueChange={setNewSucursalName}
            />
            <Input
              description="Enlaza con el delivery y el consolidado. Ej: TUN, STG, CAM."
              label="Código"
              placeholder="Ej: TUN"
              value={newSucursalCodigo}
              onValueChange={(v) => setNewSucursalCodigo(v.toUpperCase())}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCreateClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              isLoading={isCreatingSucursal}
              onPress={handleCreateSucursal}
            >
              Crear
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal editar sucursal */}
      <Modal isOpen={isEditOpen} placement="center" onClose={onEditClose}>
        <ModalContent>
          <ModalHeader>Editar Sucursal</ModalHeader>
          <ModalBody>
            <Input
              label="Nombre"
              placeholder="Ej: Las Tunas"
              value={editSucursalName}
              onValueChange={setEditSucursalName}
            />
            <Input
              description="Enlaza con el delivery y el consolidado. Ej: TUN, STG, CAM."
              label="Código"
              placeholder="Ej: TUN"
              value={editSucursalCodigo}
              onValueChange={(v) => setEditSucursalCodigo(v.toUpperCase())}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onEditClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              isLoading={isUpdatingSucursal}
              onPress={handleEditSucursal}
            >
              Guardar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal eliminar sucursal */}
      <Modal
        isOpen={isDeleteSucursalOpen}
        placement="center"
        onClose={onDeleteSucursalClose}
      >
        <ModalContent>
          <ModalHeader>Eliminar Sucursal</ModalHeader>
          <ModalBody>
            <p>Esta accion no se puede deshacer.</p>
            <p>Se eliminara permanentemente la sucursal seleccionada.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteSucursalClose}>
              Cancelar
            </Button>
            <Button
              color="danger"
              isLoading={isDeletingSucursal}
              onPress={handleDeleteSucursal}
            >
              Eliminar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal de confirmación para borrar base de datos */}
      <Modal isOpen={isDeleteOpen} placement="center" onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-danger">⚠️ Zona de Peligro</span>
          </ModalHeader>
          <ModalBody>
            <div className="bg-danger-50 border-l-4 border-danger p-4 rounded">
              <p className="text-sm text-danger-700 font-semibold mb-2">
                ¿Está seguro que desea borrar la base de datos?
              </p>
              <p className="text-sm text-danger-600">
                Esta acción eliminará los siguientes datos:
              </p>
              <ul className="text-sm text-danger-600 list-disc list-inside mt-2">
                <li>Pedidos y sus items</li>
                <li>Clientes</li>
                <li>Vendedores</li>
              </ul>
              <p className="text-sm text-success-600 mt-3">
                ✓ Se mantendrán: Usuarios, Roles y Sucursales
              </p>
              <p className="text-sm text-danger-700 font-semibold mt-3">
                Esta acción NO se puede deshacer.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="flat" onPress={onDeleteClose}>
              Cancelar
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={handleDeleteDatabase}
            >
              Sí, Borrar Todo
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
};
