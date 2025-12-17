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
} from "@heroui/react";
import { useEffect, useState, useRef, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";

interface OrderItem {
  id: string;
  producto: string;
  unidades: number;
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
  const [isModalCopied, setIsModalCopied] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const abortControllerRef = useRef<AbortController | null>(null);

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
    [pagination.limit, estadoFilter, debouncedSearch],
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

        // Refetch current page and close modal
        fetchOrders(pagination.page);
        onClose();
      } catch (err) {
        alert("Error al completar el pedido");
      }
    },
    [fetchOrders, pagination.page, onClose],
  );

  const handleCopyOrder = useCallback(async () => {
    if (!selectedOrder) return;

    const vendedorNombre = selectedOrder.vendedor?.nombre || "Sin vendedor";
    const clienteCodigo =
      selectedOrder.cliente?.codigo ||
      selectedOrder.cliente?.nombre ||
      "Sin cliente";
    const text = `P-${selectedOrder.folio}; V-${vendedorNombre}; C-${clienteCodigo};`;

    const ok = await copyTextToClipboard(text);

    if (ok) {
      setIsModalCopied(true);
      setTimeout(() => setIsModalCopied(false), 2000);
    }
  }, [selectedOrder]);

  const handleOpenDetails = useCallback(
    (order: Order) => {
      setSelectedOrder(order);
      onOpen();
    },
    [onOpen],
  );

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
  }, [debouncedSearch, estadoFilter, fetchOrders]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Filters */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardBody className="gap-4">
          <div className="flex gap-6 flex-col md:flex-row">
            <Input
              isClearable
              className="flex-1"
              label="Buscar Pedido"
              placeholder="Buscar por folio, vendedor o cliente..."
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
        </CardBody>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardBody className="text-center py-6">
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
                <CardBody className="gap-4 relative overflow-visible">
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
                  <div className="w-full grid grid-cols-1 md:grid-cols-4 justify-between items-start gap-4">
                    <div className="flex items-center gap-2">
                      <Icons.receipt className="size-12 min-w-12 text-primary" />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-default-500">
                          Pedido:
                        </span>
                        <span className="text-sm text-primary font-bold">
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
                        <span className="text-sm text-primary font-bold">
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
                        <span className="text-sm text-primary font-bold">
                          {order.cliente?.nombre ?? "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="pt-1 flex justify-center md:justify-end">
                      <Button
                        className="font-bold"
                        color="primary"
                        startContent={<Icons.eye className="size-6" />}
                        variant="ghost"
                        onPress={() => handleOpenDetails(order)}
                      >
                        Ver Detalles
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Empty State */}
          {orders.length === 0 && (
            <Card className={cards({ border: "default" })}>
              <CardBody className="text-center py-6">
                <p className="text-default-500">
                  No se encontraron pedidos con los filtros aplicados
                </p>
              </CardBody>
            </Card>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex w-full justify-center">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-default-100 rounded-lg">
                      <Icons.workers className="size-10 text-primary" />
                      <div>
                        <p className="text-xs text-default-500">Vendedor</p>
                        <p className="font-semibold">
                          {selectedOrder?.vendedor?.nombre || "N/A"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-default-100 rounded-lg">
                      <Icons.client className="size-10 text-primary" />
                      <div>
                        <p className="text-xs text-default-500">Cliente</p>
                        <p className="font-semibold">
                          {selectedOrder?.cliente?.nombre || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* Order Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedOrder?.direccion && (
                      <div>
                        <p className="text-xs text-default-500">Dirección</p>
                        <p className="text-sm">{selectedOrder.direccion}</p>
                      </div>
                    )}
                    {selectedOrder?.encargado && (
                      <div>
                        <p className="text-xs text-default-500">Encargado</p>
                        <p className="text-sm">{selectedOrder.encargado}</p>
                      </div>
                    )}
                    {selectedOrder?.telefono && (
                      <div>
                        <p className="text-xs text-default-500">Teléfono</p>
                        <p className="text-sm">{selectedOrder.telefono}</p>
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
                  </div>

                  <Divider />

                  {/* Products */}
                  <div>
                    <h3 className="font-semibold mb-3">
                      Productos ({selectedOrder?.items.length || 0})
                    </h3>
                    <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                      {selectedOrder?.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center p-3 bg-default-50 rounded-lg"
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
                          <Chip size="sm" variant="flat">
                            {item.unidades} unidades
                          </Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  color={isModalCopied ? "success" : "default"}
                  startContent={
                    isModalCopied ? (
                      <Icons.check className="size-5" />
                    ) : (
                      <Icons.copy className="size-5" />
                    )
                  }
                  variant="bordered"
                  onPress={handleCopyOrder}
                >
                  {isModalCopied ? "Copiado!" : "Copiar Pedido"}
                </Button>

                {selectedOrder?.estado !== "completada" && (
                  <Button
                    color="primary"
                    startContent={<Icons.check className="size-5" />}
                    onPress={() =>
                      selectedOrder && handleCompletarOrder(selectedOrder.id)
                    }
                  >
                    Completar Pedido
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};
