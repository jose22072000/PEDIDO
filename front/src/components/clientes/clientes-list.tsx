import {
  Card,
  CardBody,
  CardHeader,
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
  Chip,
} from "@heroui/react";
import { useEffect, useState, useRef, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";

interface Cliente {
  id: string;
  nombre: string;
  codigo?: string | null;
  zona?: string | null;
  createdAt: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ClientesResponse {
  data: Cliente[];
  pagination: PaginationData;
}

export const ClientesList = () => {
  const [clientes, setClientes] = useState<Cliente[]>([]);
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
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [copiedClienteId, setCopiedClienteId] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchClientes = useCallback(
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

        if (debouncedSearch.length > 0) {
          params.append("search", debouncedSearch);
        }

        const response = await fetch(`${getApiBaseUrl()}/clientes?${params}`, {
          credentials: "include",
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Error al cargar los clientes");
        }

        const data: ClientesResponse = await response.json();

        setClientes(data.data);
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
    [pagination.limit, debouncedSearch],
  );

  const handleOpenDetails = useCallback(
    (cliente: Cliente) => {
      setSelectedCliente(cliente);
      onOpen();
    },
    [onOpen],
  );

  const handleCopy = useCallback(async (cliente: Cliente) => {
    const text = `C-${cliente.nombre};`;
    const ok = await copyTextToClipboard(text);

    if (ok) {
      setCopiedClienteId(cliente.id);
      setTimeout(() => setCopiedClienteId(null), 2000);
    }
  }, []);

  // Debounced search with cleanup
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  // Fetch clientes when dependencies change
  useEffect(() => {
    fetchClientes(1);
  }, [debouncedSearch]);

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
        <CardHeader>
          <h3 className="font-bold text-lg">Filtrar</h3>
        </CardHeader>
        <CardBody className="gap-4">
          <Input
            isClearable
            placeholder="Buscar por nombre o parranda ID..."
            size="lg"
            startContent={<Icons.search className="size-5 text-default-400" />}
            value={searchValue}
            variant="bordered"
            onChange={(e) => setSearchValue(e.target.value)}
            onClear={() => setSearchValue("")}
          />
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
              onPress={() => fetchClientes(pagination.page)}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Clientes List */}
      {!isLoading && !error && (
        <>
          <div className="flex flex-col gap-2">
            {clientes.map((cliente) => (
              <Card
                key={cliente.id}
                className={cn(cards({ border: "default" }))}
              >
                <CardBody>
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <Icons.client className="size-10 min-w-10 text-primary" />
                      <div>
                        <p className="font-semibold text-lg">
                          {cliente.nombre}
                        </p>
                        <Chip
                          className="border-primary [&>span]:text-primary [&>span]:font-bold w-fit"
                          color="primary"
                          size="sm"
                          variant="dot"
                        >
                          {cliente.codigo || "N/A"}
                        </Chip>
                      </div>
                    </div>
                    <div className="flex flex-row gap-2 w-full md:w-auto">
                      <Button
                        className="flex-1 md:flex-none"
                        color={
                          copiedClienteId === cliente.id ? "success" : "default"
                        }
                        startContent={<Icons.copy className="size-5" />}
                        variant="ghost"
                        onPress={() => handleCopy(cliente)}
                      >
                        {copiedClienteId === cliente.id ? "Copiado" : "Copiar"}
                      </Button>
                      <Button
                        className="flex-1 md:flex-none"
                        color="primary"
                        startContent={<Icons.eye className="size-5" />}
                        variant="ghost"
                        onPress={() => handleOpenDetails(cliente)}
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
          {clientes.length === 0 && (
            <Card className={cards({ border: "default" })}>
              <CardBody className="text-center py-6">
                <p className="text-default-500">
                  No se encontraron clientes con los filtros aplicados
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
                onChange={(p) => fetchClientes(p)}
              />
            </div>
          )}

          {/* Pagination Info */}
          <div className="flex justify-center text-sm text-default-500">
            Mostrando {clientes.length} de {pagination.total} clientes
          </div>
        </>
      )}

      {/* Cliente Details Modal */}
      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        size="2xl"
        onClose={onClose}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <Icons.client className="size-8 text-primary" />
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedCliente?.nombre}
                    </h2>
                    {selectedCliente?.codigo && (
                      <p className="text-sm text-default-500">
                        Parranda ID: {selectedCliente.codigo}
                      </p>
                    )}
                  </div>
                </div>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {/* Client Details */}
                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-default-100 rounded-lg">
                      <Icons.tag className="size-8 text-primary" />
                      <div>
                        <p className="text-xs text-default-500">Parranda ID</p>
                        <p className="font-semibold">
                          {selectedCliente?.codigo || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-default-50 rounded-lg">
                    <p className="text-xs text-default-500 mb-1">
                      Fecha de Creación
                    </p>
                    <p className="font-semibold">
                      {selectedCliente?.createdAt
                        ? new Date(
                            selectedCliente.createdAt,
                          ).toLocaleDateString("es-ES", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="light" onPress={onClose}>
                  Cerrar
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};
