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
import { useAuthStore } from "@/stores/authStore";

interface Usuario {
  id: string;
  username: string;
  rol?: {
    nombre: string;
  } | null;
  sucursal?: {
    nombre: string;
  } | null;
  createdAt: string;
}

export const UsuariosList = () => {
  const { user, session } = useAuthStore();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedUsuario, setSelectedUsuario] = useState<Usuario | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    fetchUsuarios();
  }, []);

  const fetchUsuarios = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const isGlobalAdmin = Boolean(session?.isGlobalAdmin);
      const response = await fetch(
        `${getApiBaseUrl()}/users${isGlobalAdmin ? "?sucursalId=all" : ""}`,
      );

      if (!response.ok) {
        throw new Error("Error al cargar los usuarios");
      }

      const data = await response.json();

      setUsuarios(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/users/${id}`, {
        method: "DELETE",
      });


      if (!response.ok) {
        throw new Error("Error al eliminar usuario");
      }

      setSuccess("Usuario eliminado correctamente");
      setTimeout(() => setSuccess(null), 3000);
      fetchUsuarios();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteModal = (usuario: Usuario) => {
    setSelectedUsuario(usuario);
    onOpen();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner color="primary" size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className={cards()}>
        <CardBody>
          <div className="bg-danger-50 border-l-4 border-danger p-4 rounded">
            <div className="flex items-center gap-2">
              <Icons.close className="size-5 text-danger" />
              <p className="text-sm text-danger-700">{error}</p>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      {success && (
        <div className="bg-success-50 border-l-4 border-success p-4 rounded mb-4">
          <div className="flex items-center gap-2">
            <Icons.check className="size-5 text-success" />
            <p className="text-sm text-success-700">{success}</p>
          </div>
        </div>
      )}

      <Table
        aria-label="Tabla de usuarios"
        classNames={{
          th: "bg-primary text-white text-sm font-bold",
          tr: "hover:bg-primary/5 transition-colors",
          td: "align-middle text-sm",
        }}
      >
        <TableHeader>
          <TableColumn>USUARIO</TableColumn>
          <TableColumn>ROL</TableColumn>
          <TableColumn>SUCURSAL</TableColumn>
          <TableColumn>FECHA CREACIÓN</TableColumn>
          <TableColumn>ACCIONES</TableColumn>
        </TableHeader>
        <TableBody emptyContent="No hay usuarios registrados">
          {usuarios.map((usuario) => (
            <TableRow key={usuario.id}>
              <TableCell className="font-bold text-medium text-primary">
                {usuario.username}
              </TableCell>
              <TableCell>
                {usuario.rol ? (
                  <Chip
                    className="border-primary [&>span]:text-primary [&>span]:font-bold [&>span]:uppercase"
                    color="primary"
                    size="sm"
                    variant="dot"
                  >
                    {usuario.rol.nombre}
                  </Chip>
                ) : (
                  <span className="text-primary font-bold uppercase">
                    Sin rol
                  </span>
                )}
              </TableCell>
              <TableCell className="text-primary font-bold uppercase">
                {usuario.sucursal?.nombre || (
                  <span className="text-primary font-bold uppercase">
                    Sin sucursal
                  </span>
                )}
              </TableCell>
              <TableCell>
                {new Date(usuario.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  color="danger"
                  isDisabled={user?.username === usuario.username}
                  isIconOnly={true}
                  variant="flat"
                  onPress={() => openDeleteModal(usuario)}
                >
                  <Icons.trash className="size-6" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        onClose={onClose}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Icons.empty className="size-6 text-danger" />
                  <span>Confirmar Eliminación</span>
                </div>
              </ModalHeader>
              <ModalBody>
                <p>
                  ¿Está seguro que desea eliminar al usuario{" "}
                  <strong>{selectedUsuario?.username}</strong>?
                </p>
                <p className="text-small text-default-500">
                  Esta acción no se puede deshacer.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  color="default"
                  isDisabled={isDeleting}
                  variant="light"
                  onPress={onClose}
                >
                  Cancelar
                </Button>
                <Button
                  color="danger"
                  isLoading={isDeleting}
                  onPress={() =>
                    selectedUsuario && handleDelete(selectedUsuario.id)
                  }
                >
                  Eliminar
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};
