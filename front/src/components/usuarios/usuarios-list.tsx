import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Input,
  Pagination,
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
  Select,
  SelectItem,
  useDisclosure,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import Icons from "../icons/iconify";

import { cards } from "@/components/primitives";
import { getApiBaseUrl } from "@/config";
import { aplicarLote } from "@/hooks/aplicar-eventos";
import { usarUsuarios, type Usuario } from "@/stores/datos/usuarios";
import { getSucursalActiva } from "@/components/sucursal-selector";
import { useAuthStore } from "@/stores/authStore";
import { mostrarUsuario } from "@/lib/nombre-usuario";

// El tipo Usuario vive en el store (stores/datos/usuarios), no aquí: lo comparten
// quien lo pinta y quien lo trae, y así no se separan cuando cambie el api.

/**
 * Trae la lista. Va a nivel de módulo porque no depende de nada de la vista: la
 * sucursal enfocada la añade el envoltorio de fetch (main.tsx) como cabecera.
 */
const traerUsuarios = async (signal: AbortSignal): Promise<Usuario[]> => {
  const r = await fetch(`${getApiBaseUrl()}/users`, { signal });

  if (!r.ok) throw new Error("Error al cargar los usuarios");

  return r.json();
};

interface Rol {
  id: string;
  nombre: string;
}

interface Sucursal {
  id: string;
  nombre: string;
}

export const UsuariosList = () => {
  const { user, session } = useAuthStore();
  const [roles, setRoles] = useState<Rol[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  // Errores de una ACCIÓN (borrar, guardar). Los de CARGA los lleva el store.
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedUsuario, setSelectedUsuario] = useState<Usuario | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [rolFilter, setRolFilter] = useState("");
  const [sucursalFilter, setSucursalFilter] = useState("");
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Edición de usuario (modal aparte del de borrar).
  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const [editForm, setEditForm] = useState({
    id: "",
    username: "",
    rolId: "",
    sucursalId: "",
    password: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const isGlobalAdmin = Boolean(session?.isGlobalAdmin);
  const activeSucursalId = isGlobalAdmin ? getSucursalActiva() : session?.sucursalId;

  // Solo un Super Admin puede asignar el rol Super Admin (igual que al crear).
  const rolesDisponibles = useMemo(
    () =>
      isGlobalAdmin
        ? roles
        : roles.filter(
            (r) => String(r.nombre).toUpperCase() !== "SUPER ADMIN",
          ),
    [roles, isGlobalAdmin],
  );

  useEffect(() => {
    fetchRoles();
    fetchSucursales();
  }, []);

  // La lista vive en el store de usuarios, no en un useState de esta vista. Así
  // sobrevive a la navegación: salir y volver la pinta al instante en vez de
  // costar otra vuelta al servidor (~600 ms en los enlaces de las sucursales).
  //
  // La clave incluye la sucursal enfocada porque el servidor filtra por ella: sin
  // eso, cambiar de sucursal enseñaría la lista de la anterior.
  //
  // El SSE se aplica EN SITIO sobre lo cacheado (el evento trae el usuario
  // completo), así que la tabla no parpadea. Los eventos de 'vendedor' sí obligan
  // a releer —cambian el conteo de vendedores a cargo, que no viaja en el
  // evento—, pero de fondo: sin esqueleto y sin borrar lo que se está viendo.
  const {
    datos: usuarios,
    cargando: isLoading,
    error: errorCarga,
    recargar: recargarUsuarios,
  } = usarUsuarios(`usuarios:${activeSucursalId ?? "todas"}`, traerUsuarios, {
    aplicar: (actual, lote) => {
      const deUsuario = lote.filter((e) => e.tipo === "usuario");

      // Hay eventos de vendedor en la ráfaga: no se puede aplicar todo, se relee.
      if (deUsuario.length !== lote.length) return null;

      return aplicarLote<Usuario>(actual, deUsuario, {
        // El Administrador solo ve su sucursal; el Super Admin, todas.
        filtrar: (u) => !activeSucursalId || u.sucursalId === activeSucursalId,
        alPrincipio: true,
      });
    },
  });

  // Filtros en cliente (texto + rol + sucursal): /users devuelve la lista completa.
  const filteredUsuarios = useMemo(() => {
    const q = searchValue.trim().toLowerCase();

    // `usuarios` es null mientras no haya llegado la primera carga.
    return (usuarios ?? []).filter((u) => {
      if (rolFilter && (u.rol?.nombre ?? "") !== rolFilter) return false;
      if (sucursalFilter && (u.sucursal?.nombre ?? "") !== sucursalFilter) return false;
      if (
        q &&
        !(
          u.username.toLowerCase().includes(q) ||
          (u.rol?.nombre ?? "").toLowerCase().includes(q) ||
          (u.sucursal?.nombre ?? "").toLowerCase().includes(q)
        )
      )
        return false;

      return true;
    });
  }, [usuarios, searchValue, rolFilter, sucursalFilter]);

  const totalPages = Math.ceil(filteredUsuarios.length / rowsPerPage) || 1;

  const paginatedUsuarios = useMemo(() => {
    const start = (page - 1) * rowsPerPage;

    return filteredUsuarios.slice(start, start + rowsPerPage);
  }, [filteredUsuarios, page]);

  // Volver a la primera página al cambiar la búsqueda.
  useEffect(() => {
    setPage(1);
  }, [searchValue]);

  const fetchRoles = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/roles`);

      if (response.ok) setRoles(await response.json());
    } catch {
      // Error fetching roles
    }
  };

  const fetchSucursales = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/sucursales`);

      if (response.ok) setSucursales(await response.json());
    } catch {
      // Error fetching sucursales
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
      void recargarUsuarios(true);
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

  // Abre el modal de edición. El rol/sucursal viene por nombre en la lista, así que se
  // resuelve el id contra las listas cargadas (o el id que ya traiga el usuario).
  const openEditModal = (usuario: Usuario) => {
    const rolId =
      usuario.rolId ??
      roles.find((r) => r.nombre === usuario.rol?.nombre)?.id ??
      "";
    const sucursalId =
      usuario.sucursalId ??
      sucursales.find((s) => s.nombre === usuario.sucursal?.nombre)?.id ??
      "";

    setEditForm({
      id: usuario.id,
      username: usuario.username,
      rolId,
      sucursalId,
      password: "",
    });
    setEditError(null);
    onEditOpen();
  };

  const handleSave = async () => {
    setIsSaving(true);
    setEditError(null);

    try {
      // Solo se manda la contraseña si se escribió una nueva.
      const body: Record<string, unknown> = {
        username: editForm.username.trim(),
        rolId: editForm.rolId || null,
        sucursalId: editForm.sucursalId || null,
      };

      if (editForm.password.trim()) body.password = editForm.password.trim();

      const response = await fetch(`${getApiBaseUrl()}/users/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        throw new Error(data.error || "Error al actualizar usuario");
      }

      setSuccess("Usuario actualizado correctamente");
      setTimeout(() => setSuccess(null), 3000);
      void recargarUsuarios(true);
      onEditClose();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSaving(false);
    }
  };

  // `usuarios === null` = todavía no ha llegado nada. Sin esta condición, en el
  // primer render (antes de que arranque el efecto de carga) se vería un parpadeo
  // de "no hay usuarios" antes del spinner.
  if (isLoading || usuarios === null) {
    return (
      <div className="flex justify-center p-8">
        <Spinner color="primary" size="lg" />
      </div>
    );
  }

  const errorVisible = error ?? errorCarga;

  if (errorVisible) {
    return (
      <Card className={cards()}>
        <CardBody>
          <div className="bg-danger-50 border-l-4 border-danger p-4 rounded">
            <div className="flex items-center gap-2">
              <Icons.close className="size-5 text-danger" />
              <p className="text-sm text-danger-700">{errorVisible}</p>
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

      <Card className={cards({ border: "default" }) + " mb-4"}>
        <CardHeader>
          <h3 className="font-bold text-lg">Filtrar</h3>
        </CardHeader>
        <CardBody>
          <Input
            isClearable
            autoComplete="off"
            name="buscar-usuarios"
            placeholder="Buscar por usuario, rol o sucursal..."
            size="lg"
            startContent={<Icons.search className="size-5 text-default-400" />}
            value={searchValue}
            variant="bordered"
            onChange={(e) => setSearchValue(e.target.value)}
            onClear={() => setSearchValue("")}
          />
          <div className="flex flex-col md:flex-row gap-4 mt-4">
            <Select
              className="md:max-w-xs"
              label="Rol"
              placeholder="Todos los roles"
              selectedKeys={rolFilter ? [rolFilter] : []}
              variant="bordered"
              onChange={(e) =>
                setRolFilter(e.target.value === "__all__" ? "" : e.target.value)
              }
            >
              {[
                <SelectItem key="__all__">Todos los roles</SelectItem>,
                ...roles.map((r) => (
                  <SelectItem key={r.nombre}>{r.nombre}</SelectItem>
                )),
              ]}
            </Select>
            <Select
              className="md:max-w-xs"
              label="Sucursal"
              placeholder="Todas las sucursales"
              selectedKeys={sucursalFilter ? [sucursalFilter] : []}
              variant="bordered"
              onChange={(e) =>
                setSucursalFilter(
                  e.target.value === "__all__" ? "" : e.target.value,
                )
              }
            >
              {[
                <SelectItem key="__all__">Todas las sucursales</SelectItem>,
                ...sucursales.map((s) => (
                  <SelectItem key={s.nombre}>{s.nombre}</SelectItem>
                )),
              ]}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Table
        aria-label="Tabla de usuarios"
        bottomContent={
          totalPages > 1 ? (
            <div className="flex w-full justify-center">
              <Pagination
                isCompact
                showControls
                showShadow
                color="primary"
                page={page}
                total={totalPages}
                onChange={(p) => setPage(p)}
              />
            </div>
          ) : null
        }
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
          {paginatedUsuarios.map((usuario) => {
            const isSameBranch = activeSucursalId && usuario.sucursalId === activeSucursalId;

            return (
              <TableRow
                key={usuario.id}
                className={isSameBranch ? "bg-success-50" : ""}
              >
                <TableCell className="font-bold text-medium text-primary">
                  <div className="flex items-center gap-2">
                    {isSameBranch && (
                      <span className="inline-block size-2 rounded-full bg-success" />
                    )}
                    {mostrarUsuario(usuario.username)}
                  </div>
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
                  <div className="flex items-center gap-2">
                    <Button
                      aria-label="Editar usuario"
                      color="primary"
                      isIconOnly={true}
                      variant="flat"
                      onPress={() => openEditModal(usuario)}
                    >
                      <Icons.edit className="size-6" />
                    </Button>
                    <Button
                      aria-label="Eliminar usuario"
                      color="danger"
                      isDisabled={user?.username === usuario.username}
                      isIconOnly={true}
                      variant="flat"
                      onPress={() => openDeleteModal(usuario)}
                    >
                      <Icons.trash className="size-6" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Modal EDITAR usuario */}
      <Modal
        isDismissable={false}
        isOpen={isEditOpen}
        placement="center"
        scrollBehavior="outside"
        onClose={onEditClose}
      >
        <ModalContent>
          {(onCloseInner) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Icons.edit className="size-6 text-primary" />
                  <span>Editar usuario</span>
                </div>
              </ModalHeader>
              <ModalBody className="gap-4">
                {editError && (
                  <div className="bg-danger-50 border-l-4 border-danger p-3 rounded text-sm text-danger-700">
                    {editError}
                  </div>
                )}
                <Input
                  autoComplete="off"
                  label="Nombre de usuario"
                  name="edit-username"
                  value={editForm.username}
                  variant="bordered"
                  onChange={(e) =>
                    setEditForm({ ...editForm, username: e.target.value })
                  }
                />
                <Select
                  label="Rol"
                  selectedKeys={editForm.rolId ? [editForm.rolId] : []}
                  variant="bordered"
                  onChange={(e) =>
                    setEditForm({ ...editForm, rolId: e.target.value })
                  }
                >
                  {rolesDisponibles.map((rol) => (
                    <SelectItem key={rol.id}>{rol.nombre}</SelectItem>
                  ))}
                </Select>
                {/* Super Admin es global: no lleva sucursal → se oculta el selector. */}
                {String(
                  roles.find((r) => r.id === editForm.rolId)?.nombre || "",
                ).toUpperCase() !== "SUPER ADMIN" && (
                  <Select
                    label="Sucursal"
                    selectedKeys={editForm.sucursalId ? [editForm.sucursalId] : []}
                    variant="bordered"
                    onChange={(e) =>
                      setEditForm({ ...editForm, sucursalId: e.target.value })
                    }
                  >
                    {sucursales.map((sucursal) => (
                      <SelectItem key={sucursal.id}>{sucursal.nombre}</SelectItem>
                    ))}
                  </Select>
                )}
                <Input
                  autoComplete="new-password"
                  label="Nueva contraseña"
                  name="edit-password"
                  placeholder="Dejar vacío para no cambiarla"
                  type="password"
                  value={editForm.password}
                  variant="bordered"
                  onChange={(e) =>
                    setEditForm({ ...editForm, password: e.target.value })
                  }
                />
              </ModalBody>
              <ModalFooter>
                <Button
                  color="default"
                  isDisabled={isSaving}
                  variant="light"
                  onPress={onCloseInner}
                >
                  Cancelar
                </Button>
                <Button
                  color="primary"
                  isDisabled={!editForm.username.trim()}
                  isLoading={isSaving}
                  onPress={handleSave}
                >
                  Guardar cambios
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Modal ELIMINAR usuario */}
      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        onClose={onClose}
      >
        <ModalContent>
          {(onCloseInner) => (
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
                  <strong>{mostrarUsuario(selectedUsuario?.username)}</strong>?
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
                  onPress={onCloseInner}
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
