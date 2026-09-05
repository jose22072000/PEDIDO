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
import {
  usarUsuarios,
  type Usuario,
  type RespuestaUsuarios,
} from "@/stores/datos/usuarios";
import { getSucursalActiva } from "@/components/sucursal-selector";
import { useAuthStore } from "@/stores/authStore";
import { mostrarUsuario } from "@/lib/nombre-usuario";
import { useCerrarAlPulsarFuera } from "@/hooks/cerrar-al-pulsar-fuera";

// El tipo Usuario vive en el store (stores/datos/usuarios), no aquí: lo comparten
// quien lo pinta y quien lo trae, y así no se separan cuando cambie el api.

/**
 * Lo que devuelve GET /users/:id/vendedores: qué impide borrar a este usuario y a
 * quién se le pueden pasar sus vendedores.
 *
 * Borrar un usuario que lleva vendedores los dejaba "Sin asignar" en silencio, y
 * todo lo que subieran a partir de ahí se guardaba sin sucursal y desaparecía de
 * la vista. Ahora la pantalla enseña el problema y su solución a la vez.
 */
type DependenciasUsuario = {
  vendedores: Array<{
    id: string;
    nombre: string;
    codigo: string | null;
    pedidos: number;
    activo: boolean;
  }>;
  // El usuario no tiene campo `nombre` en el modelo: se identifica por username.
  candidatos: Array<{ id: string; username: string }>;
  sePuedeEliminar: boolean;
};

/**
 * Trae la lista. Va a nivel de módulo porque no depende de nada de la vista: la
 * sucursal enfocada la añade el envoltorio de fetch (main.tsx) como cabecera.
 */
const traerUsuarios =
  (page: number, search: string, rol: string, sucursalId: string) =>
  async (signal: AbortSignal): Promise<RespuestaUsuarios> => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(POR_PAGINA),
    });

    if (search) params.append("search", search);
    if (rol) params.append("rol", rol);
    // La sucursal va al SERVIDOR, no se filtra aqui. Filtrar en el navegador
    // solo tocaba la pagina que se estaba viendo: se quedaba 1 fila en pantalla
    // y el paginador seguia diciendo 16 paginas, porque el total lo da el
    // servidor y no sabia nada de ese filtro.
    //
    // El api usa este mismo parametro para acotar el alcance, asi que ademas es
    // seguro: quien no es Super Admin no puede pedir otra sucursal que la suya.
    if (sucursalId) params.append("sucursalId", sucursalId);

    const r = await fetch(`${getApiBaseUrl()}/users?${params}`, { signal });

    if (!r.ok) throw new Error("Error al cargar los usuarios");

    return r.json();
  };

const POR_PAGINA = 10;

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

  // Lo que bloquea el borrado del usuario seleccionado (sus vendedores) y a quién
  // se le pueden pasar. Null mientras no se haya consultado.
  const [dependencias, setDependencias] = useState<DependenciasUsuario | null>(null);
  const [cargandoDependencias, setCargandoDependencias] = useState(false);
  const [nuevoGestor, setNuevoGestor] = useState("");
  const [reasignando, setReasignando] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [rolFilter, setRolFilter] = useState("");
  const [sucursalFilter, setSucursalFilter] = useState("");
  const [page, setPage] = useState(1);
  // Freno de la busqueda: ahora la hace el SERVIDOR, asi que sin esto seria una
  // peticion por cada tecla.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchValue.trim()), 350);

    return () => clearTimeout(t);
  }, [searchValue]);

  // Al cambiar de filtro se vuelve a la primera pagina: si no, se queda en la 7
  // de una lista que ahora tiene 2 y parece que no hay nadie.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, rolFilter, sucursalFilter]);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Pulsar fuera cierra; elegir en un desplegable NO (se dibuja fuera del modal).
  useCerrarAlPulsarFuera(isOpen, onClose);

  // Edición de usuario (modal aparte del de borrar).
  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();

  // El de editar, igual: dentro hay desplegables de rol y de sucursal.
  useCerrarAlPulsarFuera(isEditOpen, onEditClose);
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
  } = usarUsuarios(
    // La pagina y los filtros van en la CLAVE: cada combinacion se cachea
    // aparte, asi volver a la pagina anterior es instantaneo.
    `usuarios:${activeSucursalId ?? "todas"}:${page}:${debouncedSearch}:${rolFilter}:${sucursalFilter}`,
    traerUsuarios(page, debouncedSearch, rolFilter, sucursalFilter),
    {
    aplicar: (actual, lote) => {
      const deUsuario = lote.filter((e) => e.tipo === "usuario");

      // Hay eventos de vendedor en la ráfaga: no se puede aplicar todo, se relee.
      if (deUsuario.length !== lote.length) return null;

      // El evento se aplica sobre la PAGINA que se esta viendo.
      const lista = aplicarLote<Usuario>(actual.data, deUsuario, {
        // El Administrador solo ve su sucursal; el Super Admin, todas.
        filtrar: (u) => !activeSucursalId || u.sucursalId === activeSucursalId,
        alPrincipio: true,
      });

      if (lista === null) return null;

      return lista === actual.data ? actual : { ...actual, data: lista };
    },
  });

  // TODOS los filtros los aplica el SERVIDOR: texto, rol y sucursal.
  //
  // Filtrar en el navegador obligaba a bajarse los 164 usuarios enteros en cada
  // carga (63 KB) — esa era la espera larga al cambiar a "todas las sucursales".
  // Y al paginar en el servidor pero dejar el filtro de sucursal aqui, el
  // resultado era peor: filtrar dejaba UNA fila en pantalla y el paginador
  // seguia diciendo 16 paginas, porque el total lo daba el servidor y no sabia
  // nada de ese filtro. Los dos tienen que contar lo mismo.
  const filteredUsuarios = usuarios?.data ?? [];

  const totalPages = usuarios?.totalPages ?? 1;

  const paginatedUsuarios = useMemo(() => {
    // Ya viene cortada del servidor: aqui no se recorta nada mas.
    return filteredUsuarios;
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
        const cuerpo = await response.json().catch(() => ({}));

        // El api bloquea el borrado si el usuario lleva vendedores. En vez de
        // enseñar un error sin salida, se recarga la lista y el modal pasa a
        // ofrecer la reasignación.
        if (response.status === 409 && cuerpo.codigo === "VENDEDORES_ASIGNADOS") {
          await cargarDependencias(id);
          throw new Error(cuerpo.error ?? "El usuario tiene vendedores asignados");
        }
        throw new Error(cuerpo.error ?? "Error al eliminar usuario");
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

  // Qué impide borrar a este usuario y a quién se le pueden pasar sus vendedores.
  // Se pide al abrir el modal para poder enseñar el problema Y su solución juntos,
  // en vez de dejar que el usuario descubra el bloqueo al pulsar Eliminar.
  const cargarDependencias = async (id: string) => {
    setCargandoDependencias(true);
    setNuevoGestor("");
    try {
      const r = await fetch(`${getApiBaseUrl()}/users/${id}/vendedores`);

      setDependencias(r.ok ? await r.json() : null);
    } catch {
      setDependencias(null);
    } finally {
      setCargandoDependencias(false);
    }
  };

  const handleReasignar = async () => {
    if (!selectedUsuario || !nuevoGestor) return;
    setReasignando(true);
    setError(null);

    try {
      const r = await fetch(
        `${getApiBaseUrl()}/users/${selectedUsuario.id}/reasignar-vendedores`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gestorId: nuevoGestor }),
        },
      );
      const cuerpo = await r.json().catch(() => ({}));

      if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo reasignar");

      const f = cuerpo.backfill?.fusionados ?? 0;

      setSuccess(
        `${cuerpo.movidos} vendedor(es) reasignado(s)` +
          (f > 0 ? ` · ${f} cliente(s) duplicado(s) unificado(s)` : ""),
      );
      setTimeout(() => setSuccess(null), 5000);
      // Se recargan las dependencias: si ya no queda ninguno, el botón de
      // eliminar se habilita solo.
      await cargarDependencias(selectedUsuario.id);
      void recargarUsuarios(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setReasignando(false);
    }
  };

  const openDeleteModal = (usuario: Usuario) => {
    setSelectedUsuario(usuario);
    setError(null);
    setDependencias(null);
    onOpen();
    void cargarDependencias(usuario.id);
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
            {/* Sin etiqueta dentro y en `lg`, como el buscador de arriba: es lo
                que hace que todas las cajas de la fila midan igual. */}
            <Select
              className="md:max-w-xs"
              label="Rol"
              placeholder="Todos los roles"
              selectedKeys={rolFilter ? [rolFilter] : []}
              size="lg"
              startContent={<Icons.filter className="size-5 text-default-400" />}
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
              size="lg"
              startContent={
                <Icons.building className="size-5 text-default-400" />
              }
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
                  // La clave es el ID: es lo que entiende el servidor. Antes era
                  // el nombre, que solo servia para comparar en el navegador.
                  <SelectItem key={s.id} textValue={s.nombre}>
                    {s.nombre}
                  </SelectItem>
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
      {/* `isDismissable={false}` y el cierre a mano, igual que el de editar: dentro hay
          un desplegable para elegir a quién se le pasan los vendedores, y su lista se
          dibuja FUERA del modal. Con el de la librería, elegir un usuario contaba como
          pulsar fuera y cerraba el modal antes de poder reasignar nada.
          `useCerrarAlPulsarFuera` sí distingue: descarta lo que caiga en un listbox. */}
      <Modal
        isDismissable={false}
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

                {cargandoDependencias && (
                  <div className="flex items-center gap-2 text-small text-default-500">
                    <Spinner size="sm" />
                    Comprobando si lleva vendedores…
                  </div>
                )}

                {!cargandoDependencias && dependencias && !dependencias.sePuedeEliminar && (
                  <div className="flex flex-col gap-3 rounded-large border border-warning-200 bg-warning-50 p-3">
                    <div className="flex items-start gap-2">
                      <Icons.empty className="mt-0.5 size-5 shrink-0 text-warning-600" />
                      <div className="text-small">
                        <p className="font-semibold text-warning-700">
                          No se puede eliminar todavía
                        </p>
                        <p className="text-warning-700/80">
                          {/* Sólo bloquean los que están EN ACTIVO Y CON PEDIDOS: sin
                              gestor quedarían «sin asignar» y ese histórico saldría de
                              los informes. Decir «lleva N vendedores» a secas hace
                              buscar el problema en los que no lo son. */}
                          Lleva{" "}
                          {
                            dependencias.vendedores.filter(
                              (v) => v.activo && v.pedidos > 0,
                            ).length
                          }{" "}
                          vendedor(es) en activo con pedidos. Si lo borras, quedan sin
                          gestor y sus pedidos dejan de verse. Dales de baja o pásaselos
                          a otro usuario primero.
                        </p>
                      </div>
                    </div>

                    <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {dependencias.vendedores.map((v) => (
                        <li
                          key={v.id}
                          className="flex items-center justify-between gap-2 rounded-medium bg-white/60 px-2 py-1.5 text-small"
                        >
                          <span className="truncate font-medium" title={v.nombre}>
                            {v.nombre}
                          </span>
                          <Chip color="warning" size="sm" variant="flat">
                            {v.pedidos} pedido(s)
                          </Chip>
                        </li>
                      ))}
                    </ul>

                    {dependencias.candidatos.length > 0 ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Select
                          className="flex-1"
                          label="Pasárselos a"
                          placeholder="Elige un usuario"
                          selectedKeys={nuevoGestor ? [nuevoGestor] : []}
                          size="sm"
                          onChange={(e) => setNuevoGestor(e.target.value)}
                        >
                          {dependencias.candidatos.map((c) => (
                            <SelectItem key={c.id}>
                              {mostrarUsuario(c.username)}
                            </SelectItem>
                          ))}
                        </Select>
                        <Button
                          color="warning"
                          isDisabled={!nuevoGestor}
                          isLoading={reasignando}
                          size="sm"
                          onPress={handleReasignar}
                        >
                          Reasignar
                        </Button>
                      </div>
                    ) : (
                      <p className="text-small text-warning-700/80">
                        No hay ningún otro usuario en esta sucursal con rol Gestor o
                        Supervisor. Crea uno antes de poder eliminar este.
                      </p>
                    )}
                  </div>
                )}

                {/* Se puede borrar: pero antes se dice QUÉ se lleva por delante y qué
                    se queda. «No se puede deshacer» a secas no dice si va a perder
                    algo, y aquí la respuesta depende de lo que lleve cada vendedor. */}
                {!cargandoDependencias && dependencias?.sePuedeEliminar && (
                  <div className="flex flex-col gap-2 text-small">
                    {(() => {
                      const vs = dependencias.vendedores;
                      const seVan = vs.filter((v) => v.pedidos === 0);
                      const seQuedan = vs.filter((v) => v.pedidos > 0);

                      return (
                        <>
                          {seVan.length > 0 && (
                            <div className="rounded-large border border-danger-200 bg-danger-50 p-3">
                              <p className="font-semibold text-danger-700">
                                Se borran también {seVan.length} vendedor(es)
                              </p>
                              <p className="text-danger-700/80">
                                {seVan.map((v) => v.nombre).join(", ")} — no tienen
                                ningún pedido, así que no se pierde nada. Si vuelven a
                                aparecer en un CSV, se crean otra vez.
                              </p>
                            </div>
                          )}
                          {seQuedan.length > 0 && (
                            <div className="rounded-large border border-default-200 bg-default-50 p-3">
                              <p className="font-semibold text-default-700">
                                Se quedan {seQuedan.length} vendedor(es), con su histórico
                              </p>
                              <p className="text-default-500">
                                {seQuedan
                                  .map((v) => `${v.nombre} (${v.pedidos} pedidos)`)
                                  .join(", ")}{" "}
                                — pierden el gestor y conservan su sucursal y sus pedidos.
                              </p>
                            </div>
                          )}
                          {vs.length === 0 && (
                            <p className="text-default-500">
                              No lleva vendedores. Esta acción no se puede deshacer.
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  color="default"
                  isDisabled={isDeleting || reasignando}
                  variant="light"
                  onPress={onCloseInner}
                >
                  Cancelar
                </Button>
                <Button
                  color="danger"
                  // Se habilita solo cuando ya no queda nada que lo bloquee. El api
                  // vuelve a comprobarlo: esconder el botón no es protección.
                  isDisabled={
                    cargandoDependencias ||
                    reasignando ||
                    !dependencias?.sePuedeEliminar
                  }
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
