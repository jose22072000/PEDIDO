import {
  Card,
  CardBody,
  Chip,
  Pagination,
  Button,
  Input,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Divider,
  Select,
  SelectItem,
  addToast,
  Tooltip,
  Switch,
} from "@heroui/react";
import { useEffect, useState, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { registrarCopia } from "@/lib/registrar-copia";
import { esFechaEnviable } from "@/lib/fecha-enviable";
import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import { useLiveStatus } from "@/hooks/use-live-events";
import { aplicarLote } from "@/hooks/aplicar-eventos";
import { getSucursalActiva } from "@/components/sucursal-selector";
import {
  usarPedidos,
  type Order,
  type RespuestaPedidos,
} from "@/stores/datos/pedidos";

// Los tipos del listado viven en el store: los comparten quien los pinta y quien
// los trae, y asi no se separan cuando cambie el api.

const estadoColors: Record<string, "success" | "warning" | "danger"> = {
  completada: "success",
  en_proceso: "warning",
  expirada: "danger",
};

const estadoLabels: Record<string, string> = {
  todos: "Todos",
  completada: "Completado",
  en_proceso: "En Proceso",
  expirada: "Expirado",
};

const estadoOptions = [
  { value: "todos", label: "Todos" },
  { value: "en_proceso", label: "En Proceso" },
  { value: "completada", label: "Completado" },
  { value: "expirada", label: "Expirado" },
];

// Formatea el costo de domicilio (USD) a 2 decimales para mostrar.
const fmtUsd = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const domicilioOptions = [
  { value: "todos", label: "Todos" },
  { value: "calculado", label: "Con domicilio (con precio)" },
  { value: "pendiente", label: "Domicilio sin calcular" },
  { value: "requiere", label: "Requieren domicilio" },
  { value: "sin", label: "Sin domicilio" },
];

interface VendedorOpt {
  id: string;
  nombre: string;
  codigo?: string | null;
}

/** Cuantos pedidos por pagina. Fijo, asi que no hace falta llevarlo en estado. */
const POR_PAGINA = 10;

// Referencias FIJAS para cuando aun no hay datos: en linea serian objetos nuevos
// en cada render y dispararian efectos y memos sin parar.
const SIN_PEDIDOS: Order[] = [];
const PAGINACION_VACIA = {
  page: 1,
  limit: POR_PAGINA,
  total: 0,
  totalPages: 1,
};

interface FiltrosPedidos {
  page: number;
  estado: string;
  search: string;
  fechaDesde: string;
  fechaHasta: string;
  domicilio: string;
  vendedor: string;
  incluirArchivados: boolean;
}

/** La clave de cache: TIENE que llevar todo lo que cambia el resultado. */
const clavePedidos = (f: FiltrosPedidos, sucursal: string) =>
  [
    "pedidos",
    sucursal,
    f.page,
    f.estado,
    f.search,
    f.fechaDesde,
    f.fechaHasta,
    f.domicilio,
    f.vendedor,
    f.incluirArchivados ? "1" : "0",
  ].join(":");

const traerPedidos =
  (f: FiltrosPedidos) =>
  async (signal: AbortSignal): Promise<RespuestaPedidos> => {
    const params = new URLSearchParams({
      page: String(f.page),
      limit: String(POR_PAGINA),
    });

    if (f.estado !== "todos") params.append("estado", f.estado);
    if (f.search.length > 0) params.append("search", f.search);
    // Solo si estan COMPLETAS: una fecha a medio teclear tumbaba la consulta.
    if (esFechaEnviable(f.fechaDesde)) params.append("fechaDesde", f.fechaDesde);
    if (esFechaEnviable(f.fechaHasta)) params.append("fechaHasta", f.fechaHasta);
    if (f.domicilio !== "todos") params.append("domicilio", f.domicilio);
    if (f.vendedor !== "todos") params.append("vendedorId", f.vendedor);
    // Switch: si esta activo, la busqueda incluye tambien los archivados (se
    // distinguen en la tarjeta con el chip "Archivado"). Si no, solo activos.
    if (f.incluirArchivados) params.append("incluirArchivados", "1");

    const r = await fetch(`${getApiBaseUrl()}/orders?${params}`, { signal });

    if (!r.ok) throw new Error("Error al cargar los pedidos");

    return r.json();
  };

export const OrdersList = () => {
  const [page, setPage] = useState(1);
  const [estadoFilter, setEstadoFilter] = useState<string>("todos");
  const [domicilioFilter, setDomicilioFilter] = useState<string>("todos");
  const [vendedorFilter, setVendedorFilter] = useState<string>("todos");
  const [vendedores, setVendedores] = useState<VendedorOpt[]>([]);
  // Incluir archivados en la búsqueda actual (el usuario elige). No aplica cuando el
  // estado ya es "archivados" (ahí se ven solo archivados).
  const [incluirArchivados, setIncluirArchivados] = useState(false);
  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchValue, setSearchValue] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [orderToComplete, setOrderToComplete] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const live = useLiveStatus(); // estado de la conexión SSE compartida de la app
  const [nuevosPend, setNuevosPend] = useState(0); // pedidos nuevos no mostrados (con filtros/otra página)
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isConfirmOpen,
    onOpen: onConfirmOpen,
    onClose: onConfirmClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteConfirmOpen,
    onOpen: onDeleteConfirmOpen,
    onClose: onDeleteConfirmClose,
  } = useDisclosure();
  const { session } = useAuthStore();

  // Check if user can delete orders (Administrador or Supervisor)
  const canDeleteOrders =
    session?.rol === "ADMINISTRADOR" || session?.rol === "SUPERVISOR";

  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;

  const filtros: FiltrosPedidos = {
    page,
    estado: estadoFilter,
    search: debouncedSearch,
    fechaDesde,
    fechaHasta,
    domicilio: domicilioFilter,
    vendedor: vendedorFilter,
    incluirArchivados,
  };

  // Sin filtros = primera pagina y orden por fecha: ahi SI se puede insertar un
  // pedido nuevo arriba sin mentir sobre lo que la lista dice estar enseniando.
  // Con filtros solo se cuenta y se avisa ("hay N nuevos").
  const sinFiltros =
    page === 1 &&
    !debouncedSearch &&
    estadoFilter === "todos" &&
    domicilioFilter === "todos" &&
    vendedorFilter === "todos" &&
    !fechaDesde &&
    !fechaHasta;

  // La lista vive en el store: cada combinacion de pagina + filtros se cachea por
  // separado, asi que volver a una consulta ya vista es instantaneo en vez de
  // costar otra vuelta al servidor.
  const {
    datos,
    cargando: isLoading,
    error,
    recargar: fetchOrders,
  } = usarPedidos(
    clavePedidos(filtros, activeSucursalId ?? "todas"),
    traerPedidos(filtros),
    {
      tipos: ["pedido"],
      aplicar: (actual, lote) => {
        const lista = aplicarLote<Order>(actual.data, lote, {
          alPrincipio: sinFiltros,
        });

        if (lista === null) return null;

        if (!sinFiltros) {
          // Los pedidos nuevos que NO caben en la vista filtrada se cuentan aparte.
          const nuevos = lote.filter(
            (e) =>
              e.accion === "create" && !actual.data.some((o) => o.id === e.id),
          ).length;

          if (nuevos) setNuevosPend((n) => n + nuevos);
        }

        return lista === actual.data ? actual : { ...actual, data: lista };
      },
    },
  );

  const orders = datos?.data ?? SIN_PEDIDOS;
  const pagination = datos?.pagination ?? PAGINACION_VACIA;

  /**
   * @param fondo  recarga silenciosa: sin esqueleto y sin pintar errores. La usa el
   *               SSE cuando llega un cambio masivo que no se puede aplicar en sitio.
   */

  const handleCompletarOrder = useCallback(
    async (orderId: string) => {
      try {
        const response = await fetch(
          `${getApiBaseUrl()}/orders/${orderId}/completar`,
          {
            method: "PATCH",
          },
        );

        if (!response.ok) {
          throw new Error("Error al completar el pedido");
        }

        // Refetch current page and close modals
        void fetchOrders(true);
        onClose();
        onConfirmClose();
        setOrderToComplete(null);
      } catch (err) {
        alert("Error al completar el pedido");
      }
    },
    [fetchOrders, onClose, onConfirmClose],
  );

  const handleDeleteOrder = useCallback(
    async (orderId: string) => {
      setIsDeleting(true);
      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${getApiBaseUrl()}/orders/${orderId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json();

          throw new Error(data.error || "Error al eliminar el pedido");
        }

        addToast({
          title: "Pedido eliminado",
          description: "El pedido ha sido eliminado correctamente.",
          color: "success",
        });

        // Refetch current page and close modals
        void fetchOrders(true);
        onClose();
        onDeleteConfirmClose();
        setOrderToDelete(null);
        setSelectedOrder(null);
      } catch (err) {
        addToast({
          title: "Error",
          description:
            err instanceof Error ? err.message : "Error al eliminar el pedido",
          color: "danger",
        });
      } finally {
        setIsDeleting(false);
      }
    },
    [fetchOrders, onClose, onDeleteConfirmClose],
  );

  const handleAskConfirmDelete = useCallback(
    (order: Order) => {
      setOrderToDelete(order);
      onDeleteConfirmOpen();
    },
    [onDeleteConfirmOpen],
  );

  const handleAskConfirmComplete = useCallback(
    (order: Order) => {
      setOrderToComplete(order);
      onConfirmOpen();
    },
    [onConfirmOpen],
  );

  const handleOpenDetails = useCallback(
    (order: Order) => {
      setSelectedOrder(order);
      onOpen();
    },
    [onOpen],
  );

  const handleCopyFromList = useCallback(async (order: Order) => {
    const vendedorNombre = order.vendedor?.nombre || "Sin vendedor";
    const clienteCodigo =
      order.cliente?.codigo || order.cliente?.nombre || "Sin cliente";
    const text = `P-${order.folio}; V-${vendedorNombre}; C-${clienteCodigo};`;

    const ok = await copyTextToClipboard(text);

    if (ok) {
      // Esta es la copia que se pega en la observacion de la factura: la que
      // mide el uso real del puente con el sistema contable.
      registrarCopia({
        tipo: "pedido",
        pedidoId: order.id,
        vendedorId: order.vendedor?.id,
        clienteId: order.cliente?.id,
      });
      setCopiedOrderId(order.id);
      setTimeout(() => setCopiedOrderId(null), 2000);
    } else {
      addToast({
        title: "Error al copiar",
        description:
          "No se pudo copiar automáticamente. Abre el pedido para copiar manualmente.",
        color: "warning",
      });
    }
  }, []);

  // Debounced search with cleanup
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  // Lista para el filtro (desplegable) — el USUARIO/gestor vinculado, uno por persona,
  // scopeado a la sucursal (así no salen dos "Alexander" por encoding distinto).
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/vendedores/usuarios`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v: VendedorOpt[]) => setVendedores(Array.isArray(v) ? v : []))
      .catch(() => setVendedores([]));
  }, []);
  // Al cambiar un filtro se vuelve a la primera pagina: la 7 de una busqueda no
  // significa nada en la siguiente. El store pide lo que falte al cambiar la clave.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    estadoFilter,
    domicilioFilter,
    vendedorFilter,
    fechaDesde,
    fechaHasta,
    incluirArchivados,
  ]);

  // Pedidos en tiempo real: lo lleva el store (opcion `aplicar` de arriba). Va por
  // la conexion SSE UNICA de la app; antes esta vista abria su PROPIO EventSource
  // contra /orders/stream, que ademas escuchaba un canal de Redis que nadie
  // publicaba: el indicador salia verde y no llegaba jamas un pedido.

  return (
    <div className="flex flex-col w-full gap-4">
      {/* Filters */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <Input
              isClearable
              className="flex-1"
              label="Buscar Pedido"
              placeholder="Buscar por folio, vendedor, cliente, codigo o encargado..."
              size="lg"
              startContent={
                <Icons.search className="size-5 text-default-400" />
              }
              value={searchValue}
              variant="bordered"
              onChange={(e) => setSearchValue(e.target.value)}
              onClear={() => setSearchValue("")}
            />
            <Select
              className="w-full sm:w-48"
              label="Estado"
              selectedKeys={[estadoFilter]}
              size="lg"
              variant="bordered"
              onChange={(e) => setEstadoFilter(e.target.value)}
            >
              {estadoOptions.map((option) => (
                <SelectItem key={option.value}>{option.label}</SelectItem>
              ))}
            </Select>
            <Select
              className="w-full sm:w-56"
              label="Domicilio"
              selectedKeys={[domicilioFilter]}
              size="lg"
              startContent={
                <Icons.delivery className="size-5 text-default-400" />
              }
              variant="bordered"
              onChange={(e) => setDomicilioFilter(e.target.value || "todos")}
            >
              {domicilioOptions.map((option) => (
                <SelectItem key={option.value}>{option.label}</SelectItem>
              ))}
            </Select>
            <Select
              className="w-full sm:w-56"
              label="Vendedor"
              selectedKeys={[vendedorFilter]}
              size="lg"
              startContent={
                <Icons.workers className="size-5 text-default-400" />
              }
              variant="bordered"
              onChange={(e) => setVendedorFilter(e.target.value || "todos")}
            >
              {[
                <SelectItem key="todos">Todos los vendedores</SelectItem>,
                ...vendedores.map((v) => (
                  <SelectItem key={v.id}>
                    {v.nombre}
                    {v.codigo ? ` (${v.codigo})` : ""}
                  </SelectItem>
                )),
              ]}
            </Select>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Input
              isClearable
              className="flex-1"
              label="Fecha desde"
              size="lg"
              type="date"
              value={fechaDesde}
              variant="bordered"
              onChange={(e) => setFechaDesde(e.target.value)}
              onClear={() => setFechaDesde("")}
            />
            <Input
              isClearable
              className="flex-1"
              label="Fecha hasta"
              size="lg"
              type="date"
              value={fechaHasta}
              variant="bordered"
              onChange={(e) => setFechaHasta(e.target.value)}
              onClear={() => setFechaHasta("")}
            />
          </div>
          <Switch
            isSelected={incluirArchivados}
            size="sm"
            onValueChange={setIncluirArchivados}
          >
            <span className="text-sm text-default-600">
              Incluir archivados en la búsqueda
            </span>
          </Switch>
        </CardBody>
      </Card>

      {/* Barra de tiempo real (SSE) */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs",
            live
              ? "bg-success-100 text-success-700"
              : "bg-default-100 text-default-500",
          )}
        >
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              live ? "bg-success-500 animate-pulse" : "bg-default-400",
            )}
          />
          {live ? "En vivo" : "Conectando…"}
        </span>
        {nuevosPend > 0 && (
          <Button
            color="primary"
            size="sm"
            startContent={<Icons.receipt className="size-4" />}
            variant="flat"
            onPress={() => {
              setNuevosPend(0);
              setPage(1);
            }}
          >
            {nuevosPend} pedido{nuevosPend > 1 ? "s" : ""} nuevo
            {nuevosPend > 1 ? "s" : ""} — actualizar
          </Button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody className="py-6 text-center">
            <p className="text-danger">{error}</p>
            <Button
              className="mt-4"
              color="primary"
              onPress={() => fetchOrders()}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Orders List */}
      {!isLoading && !error && (
        <>
          <div className="flex flex-col gap-4">
            {orders.map((order) => (
              <Card
                key={order.id}
                className={cn(
                  cards({ border: estadoColors[order.estado] }),
                  "overflow-visible",
                )}
              >
                <CardBody className="relative gap-4 overflow-visible">
                  <div className="absolute top-0 left-0 z-10 flex items-center gap-1">
                    <Chip
                      className={`-translate-y-7 chip-${estadoColors[order.estado]}`}
                      color={estadoColors[order.estado]}
                      size="sm"
                      variant="dot"
                    >
                      {estadoLabels[order.estado]}
                    </Chip>
                    {order.archivedAt && (
                      <Chip
                        className="-translate-y-7"
                        color="default"
                        size="sm"
                        variant="flat"
                      >
                        Archivado
                      </Chip>
                    )}
                  </div>
                  {(order.costoDomicilio != null ||
                    order.requiere_domicilio) && (
                    <div className="absolute top-0 right-0 z-10">
                      <Chip
                        className="-translate-y-7"
                        color={
                          order.costoDomicilio != null ? "success" : "warning"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {order.costoDomicilio != null
                          ? `Domicilio: $${fmtUsd(order.costoDomicilio)}`
                          : "Domicilio sin calcular"}
                      </Chip>
                    </div>
                  )}
                  <div className="grid items-start justify-between w-full grid-cols-1 gap-4 md:grid-cols-4">
                    <div className="flex items-center gap-2">
                      <Icons.receipt className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Pedido:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.folio}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Icons.workers className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Vendedor:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.vendedor?.nombre ?? "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Icons.client className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Cliente:
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {order.encargado ?? "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-6 pt-1 md:justify-end">
                      <Tooltip
                        color={
                          copiedOrderId === order.id ? "success" : "default"
                        }
                        content={
                          copiedOrderId === order.id
                            ? "¡Copiado!"
                            : "Copiar Pedido"
                        }
                      >
                        <Button
                          aria-label="Copiar Pedido"
                          className="p-0"
                          color={
                            copiedOrderId === order.id ? "success" : "default"
                          }
                          isIconOnly={true}
                          variant="ghost"
                          onPress={() => handleCopyFromList(order)}
                        >
                          {copiedOrderId === order.id ? (
                            <Icons.check className="size-6" />
                          ) : (
                            <Icons.copy className="size-6" />
                          )}
                        </Button>
                      </Tooltip>
                      <Tooltip content="Ver Detalles">
                        <Button
                          aria-label="Ver Detalles"
                          className="p-0"
                          color="primary"
                          isIconOnly={true}
                          variant="ghost"
                          onPress={() => handleOpenDetails(order)}
                        >
                          <Icons.eye className="size-6" />
                        </Button>
                      </Tooltip>
                      {order.estado !== "completada" && (
                        <Tooltip content="Completar Pedido">
                          <Button
                            aria-label="Completar Pedido"
                            className="p-0"
                            color="primary"
                            isIconOnly={true}
                            variant="solid"
                            onPress={() => handleAskConfirmComplete(order)}
                          >
                            <Icons.check className="text-white size-6" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Empty State */}
          {orders.length === 0 && (
            <Card className={cards({ border: "default" })}>
              <CardBody className="py-6 text-center">
                <p className="text-default-500">
                  No se encontraron pedidos con los filtros aplicados
                </p>
              </CardBody>
            </Card>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center w-full">
              <Pagination
                isCompact
                showControls
                showShadow
                classNames={{
                  wrapper: "shadow-xl shadow-primary/5",
                  item: "cursor-pointer font-semibold",
                  cursor: "font-semibold",
                }}
                color="primary"
                page={pagination.page}
                siblings={1}
                size="lg"
                total={pagination.totalPages}
                onChange={setPage}
              />
            </div>
          )}

          {/* Pagination Info */}
          <div className="flex justify-center text-sm text-default-500">
            Mostrando {orders.length} de {pagination.total} pedidos
          </div>
        </>
      )}

      {/* Order Details Modal */}
      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        size="3xl"
        onClose={onClose}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold">
                    Pedido: {selectedOrder?.folio}
                  </h2>
                  <Chip
                    color={estadoColors[selectedOrder?.estado || "en_proceso"]}
                    size="sm"
                    variant="flat"
                  >
                    {estadoLabels[selectedOrder?.estado || "en_proceso"]}
                  </Chip>
                </div>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {/* Vendedor y Cliente */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-default-100">
                      <Icons.workers className="text-primary size-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-default-500">
                          Vendedor
                        </p>
                        <p className="font-semibold break-words">
                          {selectedOrder?.vendedor?.nombre || "Sin vendedor"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-default-100">
                      <Icons.client className="text-primary size-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-default-500">
                          Cliente / Local
                        </p>
                        <p className="font-semibold break-words">
                          {selectedOrder?.cliente?.nombre ||
                            selectedOrder?.encargado ||
                            "Sin cliente"}
                        </p>
                        {selectedOrder?.encargado && (
                          <p className="text-xs break-words text-default-500">
                            Encargado: {selectedOrder.encargado}
                          </p>
                        )}
                        {selectedOrder?.cliente?.codigo && (
                          <p className="text-xs text-default-500">
                            Código: {selectedOrder.cliente.codigo}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Datos de entrega */}
                  {(selectedOrder?.direccion ||
                    selectedOrder?.telefono ||
                    selectedOrder?.fecha_comprometida) && (
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-default-700">
                        Datos de entrega
                      </h4>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {selectedOrder?.direccion && (
                          <div className="sm:col-span-2">
                            <p className="mb-1 text-xs text-default-500">
                              Dirección
                            </p>
                            <code className="block w-full p-2 text-sm break-all border rounded bg-default-50 select-all">
                              {selectedOrder.direccion}
                            </code>
                          </div>
                        )}
                        {selectedOrder?.telefono && (
                          <div>
                            <p className="mb-1 text-xs text-default-500">
                              Teléfono
                            </p>
                            <code className="block w-full p-2 text-sm break-all border rounded bg-default-50 select-all">
                              {selectedOrder.telefono}
                            </code>
                          </div>
                        )}
                        {selectedOrder?.fecha_comprometida && (
                          <div>
                            <p className="mb-1 text-xs text-default-500">
                              Fecha comprometida
                            </p>
                            <p className="text-sm font-medium">
                              {new Date(
                                selectedOrder.fecha_comprometida,
                              ).toLocaleDateString("es-ES", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Estado y domicilio */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-default-700">
                      Estado
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        color={
                          estadoColors[selectedOrder?.estado || "en_proceso"]
                        }
                        size="sm"
                        variant="flat"
                      >
                        {estadoLabels[selectedOrder?.estado || "en_proceso"]}
                      </Chip>
                      {selectedOrder?.pedido_cobrado != null && (
                        <Chip
                          color={
                            selectedOrder.pedido_cobrado === "parcial"
                              ? "warning"
                              : selectedOrder.pedido_cobrado === "no_pagado"
                                ? "danger"
                                : "success"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {selectedOrder.pedido_cobrado === "parcial"
                            ? "Parcialmente cobrado"
                            : selectedOrder.pedido_cobrado === "no_pagado"
                              ? "No cobrado"
                              : "Cobrado"}
                        </Chip>
                      )}
                      <Chip
                        color={
                          selectedOrder?.requiere_domicilio
                            ? "primary"
                            : "default"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {selectedOrder?.requiere_domicilio
                          ? "Requiere domicilio"
                          : "Sin domicilio"}
                      </Chip>
                    </div>

                    {/* Costo del domicilio (copiable, sin el $) */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className="text-xs text-default-500">
                        Costo domicilio:
                      </span>
                      {selectedOrder?.costoDomicilio != null ? (
                        <>
                          <code className="px-2 py-1 text-sm border rounded bg-default-50 select-all">
                            <span className="select-none text-default-400">
                              $
                            </span>
                            {fmtUsd(selectedOrder.costoDomicilio)}
                          </code>
                          <Chip color="success" size="sm" variant="flat">
                            Calculado
                          </Chip>
                        </>
                      ) : selectedOrder?.requiere_domicilio ? (
                        <Chip color="warning" size="sm" variant="flat">
                          Sin calcular todavía
                        </Chip>
                      ) : (
                        <Chip color="default" size="sm" variant="flat">
                          No aplica
                        </Chip>
                      )}
                    </div>
                  </div>

                  <Divider />

                  {/* Products */}
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-default-700">
                      Productos ({selectedOrder?.items.length || 0})
                    </h4>
                    <div className="flex flex-col gap-2 overflow-y-auto max-h-60">
                      {selectedOrder?.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-default-50"
                        >
                          <div className="flex items-center gap-3">
                            <Icons.productos className="size-6 text-primary" />
                            <div>
                              <p className="font-medium">{item.producto}</p>
                              {item.descripcion && (
                                <p className="text-xs text-default-500">
                                  {item.descripcion}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {item.packs != null && item.packs > 0 && (
                              <Chip size="sm" variant="flat">
                                {item.packs} formato
                                {item.packs !== 1 ? "s" : ""}
                              </Chip>
                            )}
                            <Chip size="sm" variant="flat">
                              {item.unidades} unidades
                            </Chip>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter className="flex-col items-stretch gap-3">
                <div className="w-full p-3 border rounded-lg bg-warning-50 border-warning-200">
                  <p className="mb-2 text-xs text-warning-700">
                    Copia este texto manualmente:
                  </p>
                  <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                    {`P-${selectedOrder?.folio}; V-${selectedOrder?.vendedor?.nombre || "Sin vendedor"}; C-${selectedOrder?.cliente?.codigo || selectedOrder?.cliente?.nombre || "Sin cliente"};`}
                  </code>
                </div>
                <div className="flex justify-between w-full gap-2">
                  <div>
                    {canDeleteOrders && (
                      <Button
                        color="danger"
                        startContent={<Icons.trash className="size-5" />}
                        variant="flat"
                        onPress={() =>
                          selectedOrder && handleAskConfirmDelete(selectedOrder)
                        }
                      >
                        Eliminar Pedido
                      </Button>
                    )}
                  </div>
                  <div>
                    {selectedOrder?.estado !== "completada" && (
                      <Button
                        color="primary"
                        startContent={<Icons.check className="size-5" />}
                        onPress={() =>
                          selectedOrder &&
                          handleAskConfirmComplete(selectedOrder)
                        }
                      >
                        Completar Pedido
                      </Button>
                    )}
                  </div>
                </div>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Modal de confirmación para completar pedido */}
      <Modal isOpen={isConfirmOpen} placement="center" onClose={onConfirmClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-primary">✓ Confirmar Acción</span>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-default-700">
                ¿Estás seguro que deseas completar este pedido?
              </p>
              {orderToComplete && (
                <div className="p-3 rounded-lg bg-default-100">
                  <p className="text-sm">
                    <strong>Folio:</strong> {orderToComplete.folio}
                  </p>
                  <p className="text-sm">
                    <strong>Cliente:</strong>{" "}
                    {orderToComplete.cliente?.nombre || "N/A"}
                  </p>
                  <p className="text-sm">
                    <strong>Vendedor:</strong>{" "}
                    {orderToComplete.vendedor?.nombre || "N/A"}
                  </p>
                </div>
              )}
              <p className="text-xs text-warning-600">
                Esta acción marcará el pedido como completado.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="flat" onPress={onConfirmClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              onPress={() =>
                orderToComplete && handleCompletarOrder(orderToComplete.id)
              }
            >
              Sí, Completar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal de confirmación para eliminar pedido */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        placement="center"
        onClose={onDeleteConfirmClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-danger">⚠ Eliminar Pedido</span>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-default-700">
                ¿Estás seguro que deseas eliminar este pedido?
              </p>
              {orderToDelete && (
                <div className="p-3 rounded-lg bg-danger-50 border border-danger-200">
                  <p className="text-sm">
                    <strong>Folio:</strong> {orderToDelete.folio}
                  </p>
                  <p className="text-sm">
                    <strong>Cliente:</strong>{" "}
                    {orderToDelete.cliente?.nombre || "N/A"}
                  </p>
                  <p className="text-sm">
                    <strong>Vendedor:</strong>{" "}
                    {orderToDelete.vendedor?.nombre || "N/A"}
                  </p>
                </div>
              )}
              <p className="text-xs text-danger-600">
                Esta acción no se puede deshacer. El pedido y todos sus items
                serán eliminados permanentemente.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="default"
              variant="flat"
              onPress={onDeleteConfirmClose}
            >
              Cancelar
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={() =>
                orderToDelete && handleDeleteOrder(orderToDelete.id)
              }
            >
              Sí, Eliminar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
};
