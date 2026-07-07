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
} from "@heroui/react";
import { useEffect, useState, useRef, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";

interface OrderItem {
  id: string;
  producto: string;
  unidades: number;
  packs?: number | null;
  descripcion?: string | null;
}

interface Cliente {
  id: string;
  nombre: string;
  codigo?: string | null;
  zona?: string | null;
}

interface Vendedor {
  id: string;
  nombre: string;
  codigo?: string | null;
}

interface Order {
  id: string;
  folio: string;
  vendedorId?: string | null;
  vendedor?: Vendedor | null;
  clienteId?: string | null;
  cliente?: Cliente | null;
  direccion?: string | null;
  encargado?: string | null;
  telefono?: string | null;
  fecha: string;
  fecha_comprometida?: string | null;
  estado: string;
  pedido_cobrado?: string | null;
  requiere_domicilio?: boolean | null;
  costoDomicilio?: number | null;
  createdAt: string;
  items: OrderItem[];
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface OrdersResponse {
  data: Order[];
  pagination: PaginationData;
}

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

export const OrdersList = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [estadoFilter, setEstadoFilter] = useState<string>("todos");
  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchValue, setSearchValue] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [orderToComplete, setOrderToComplete] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [live, setLive] = useState(false); // conexión SSE viva
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const { session } = useAuthStore();

  // Check if user can delete orders (Administrador or Supervisor)
  const canDeleteOrders =
    session?.rol === "ADMINISTRADOR" || session?.rol === "SUPERVISOR";

  const fetchOrders = useCallback(
    async (page: number = 1) => {
      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pagination.limit),
        });

        // Only add estado param if not "todos"
        if (estadoFilter !== "todos") {
          params.append("estado", estadoFilter);
        }

        if (debouncedSearch.length > 0) {
          params.append("search", debouncedSearch);
        }

        if (fechaDesde) {
          params.append("fechaDesde", fechaDesde);
        }

        if (fechaHasta) {
          params.append("fechaHasta", fechaHasta);
        }

        const response = await fetch(`${getApiBaseUrl()}/orders?${params}`, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Error al cargar los pedidos");
        }

        const data: OrdersResponse = await response.json();

        setOrders(data.data);
        setPagination(data.pagination);
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setIsLoading(false);
      }
    },
    [pagination.limit, estadoFilter, debouncedSearch, fechaDesde, fechaHasta],
  );

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
        fetchOrders(pagination.page);
        onClose();
        onConfirmClose();
        setOrderToComplete(null);
      } catch (err) {
        alert("Error al completar el pedido");
      }
    },
    [fetchOrders, pagination.page, onClose, onConfirmClose],
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
        fetchOrders(pagination.page);
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
    [fetchOrders, pagination.page, onClose, onDeleteConfirmClose],
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

  // Fetch orders when dependencies change
  useEffect(() => {
    fetchOrders(1);
  }, [debouncedSearch, estadoFilter, fechaDesde, fechaHasta, fetchOrders]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Pedidos NUEVOS en tiempo real (SSE): aparecen sin refrescar la página.
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") || "" : "";
    let sucursalId = "";
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("auth-storage") : null;
      if (raw) sucursalId = JSON.parse(raw)?.state?.session?.sucursalId || "";
    } catch {
      /* ignore */
    }
    const url = `${getApiBaseUrl()}/orders/stream?sucursalId=${encodeURIComponent(sucursalId)}&token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("error", () => setLive(false));
    es.addEventListener("order", (e) => {
      let order: Order;
      try {
        order = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }
      const sinFiltros =
        pagination.page === 1 &&
        !debouncedSearch &&
        estadoFilter === "todos" &&
        !fechaDesde &&
        !fechaHasta;
      if (sinFiltros) {
        setOrders((prev) =>
          prev.some((o) => o.id === order.id) ? prev : [order, ...prev],
        );
      } else {
        setNuevosPend((n) => n + 1);
      }
    });
    return () => es.close();
  }, [pagination.page, debouncedSearch, estadoFilter, fechaDesde, fechaHasta]);

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
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Icons.receipt className="size-4" />}
            onPress={() => {
              setNuevosPend(0);
              fetchOrders(1);
            }}
          >
            {nuevosPend} pedido{nuevosPend > 1 ? "s" : ""} nuevo{nuevosPend > 1 ? "s" : ""} — actualizar
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
              onPress={() => fetchOrders(pagination.page)}
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
                  <div className="absolute top-0 left-0 z-10">
                    <Chip
                      className={`-translate-y-7 chip-${estadoColors[order.estado]}`}
                      color={estadoColors[order.estado]}
                      size="sm"
                      variant="dot"
                    >
                      {estadoLabels[order.estado]}
                    </Chip>
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
                          ? `Domicilio: ${order.costoDomicilio}`
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
                        content={
                          copiedOrderId === order.id
                            ? "¡Copiado!"
                            : "Copiar Pedido"
                        }
                        color={
                          copiedOrderId === order.id ? "success" : "default"
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
                onChange={(p) => fetchOrders(p)}
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
                  {/* Vendor and Client Info */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-default-100">
                      <Icons.workers className="size-10 text-primary" />
                      <div>
                        <p className="text-xs text-default-500">Vendedor</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder?.vendedor?.nombre || "Sin Vendedor"}
                        </code>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-default-100">
                      <Icons.client className="size-10 text-primary" />
                      <div>
                        <p className="text-xs text-default-500">Cliente</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder?.encargado || "Sin Cliente"}
                        </code>
                        <p className="mt-2 text-xs text-default-500">Codigo</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder?.cliente?.codigo ||
                            selectedOrder?.cliente?.nombre ||
                            "Sin cliente"}
                        </code>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* Order Details */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {selectedOrder?.direccion && (
                      <div>
                        <p className="text-xs text-default-500">Dirección</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder.direccion}
                        </code>
                      </div>
                    )}
                    {selectedOrder?.cliente?.nombre && (
                      <div>
                        <p className="text-xs text-default-500">Local</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder.cliente?.nombre}
                        </code>
                      </div>
                    )}
                    {selectedOrder?.telefono && (
                      <div>
                        <p className="text-xs text-default-500">Teléfono</p>
                        <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                          {selectedOrder.telefono}
                        </code>
                      </div>
                    )}
                    {selectedOrder?.fecha_comprometida && (
                      <div>
                        <p className="text-xs text-default-500">
                          Fecha Comprometida
                        </p>
                        <p className="text-sm">
                          {new Date(
                            selectedOrder.fecha_comprometida,
                          ).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                    {selectedOrder?.pedido_cobrado != null && (
                      <div>
                        <p className="text-xs text-default-500">Cobro</p>
                        <Chip
                          size="sm"
                          variant="flat"
                          color={
                            selectedOrder.pedido_cobrado === 'parcial'
                              ? 'warning'
                              : selectedOrder.pedido_cobrado === 'no_pagado'
                              ? 'danger'
                              : 'success'
                          }
                        >
                          {selectedOrder.pedido_cobrado === 'parcial'
                            ? 'Parcialmente cobrado'
                            : selectedOrder.pedido_cobrado === 'no_pagado'
                            ? 'No cobrado'
                            : selectedOrder.pedido_cobrado}
                        </Chip>
                      </div>
                    )}
                    {selectedOrder?.requiere_domicilio != null && (
                      <div>
                        <p className="text-xs text-default-500">Domicilio</p>
                        <Chip
                          size="sm"
                          variant="flat"
                          color={selectedOrder.requiere_domicilio ? 'primary' : 'default'}
                        >
                          {selectedOrder.requiere_domicilio ? 'Requiere domicilio' : 'Sin domicilio'}
                        </Chip>
                      </div>
                    )}
                    {(selectedOrder?.costoDomicilio != null ||
                      selectedOrder?.requiere_domicilio) && (
                      <div>
                        <p className="text-xs text-default-500">Costo domicilio</p>
                        {selectedOrder?.costoDomicilio != null ? (
                          <>
                            <code className="block w-full p-2 text-sm break-all bg-white border rounded select-all">
                              {selectedOrder.costoDomicilio}
                            </code>
                            <Chip
                              size="sm"
                              variant="flat"
                              color="success"
                              className="mt-1"
                            >
                              Calculado
                            </Chip>
                          </>
                        ) : (
                          <Chip size="sm" variant="flat" color="warning">
                            Sin calcular
                          </Chip>
                        )}
                      </div>
                    )}
                  </div>

                  <Divider />

                  {/* Products */}
                  <div>
                    <h3 className="mb-3 font-semibold">
                      Productos ({selectedOrder?.items.length || 0})
                    </h3>
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
                        variant="flat"
                        startContent={<Icons.trash className="size-5" />}
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
