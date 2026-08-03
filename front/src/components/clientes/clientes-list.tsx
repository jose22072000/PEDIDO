import {
  Card,
  CardBody,
  CardHeader,
  Pagination,
  Button,
  Input,
  Select,
  SelectItem,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Chip,
} from "@heroui/react";
import { useEffect, useState, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";
import { usarClientes } from "@/stores/datos/clientes";
import type {
  Cliente,
  RespuestaClientes,
  PaginacionClientes,
} from "@/stores/datos/clientes";


export const ClientesList = () => {
  const [paginaActual, setPaginaActual] = useState(1);
  const [pagination, setPagination] = useState<PaginacionClientes>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchValue, setSearchValue] = useState<string>("");
  const [municipio, setMunicipio] = useState<string>("");
  const [estadoCompra, setEstadoCompra] = useState<string>("");
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [copiedClienteId, setCopiedClienteId] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Los datos viven en el store de clientes (stores/datos/clientes), no en
  // este componente: al salir y volver se pintan al instante en vez de pedirse
  // otra vez, y los refrescos por SSE no vacían la tabla ni sacan esqueletos.
  // La clave incluye los filtros: cada combinación se cachea por separado.
  const clave = `clientes|${paginaActual}|${pagination.limit}|${debouncedSearch}|${municipio}|${estadoCompra}`;

  const {
    datos: respuesta,
    cargando: isLoading,
    error,
    recargar,
  } = usarClientes(
    clave,
    async (signal) => {
      const params = new URLSearchParams({
        page: String(paginaActual),
        limit: String(pagination.limit),
      });

      if (debouncedSearch.length > 0) params.append("search", debouncedSearch);
      if (municipio) params.append("municipio", municipio);
      if (estadoCompra) params.append("estadoCompra", estadoCompra);

      const response = await fetch(`${getApiBaseUrl()}/clientes?${params}`, { signal });

      if (!response.ok) throw new Error("Error al cargar los clientes");

      return (await response.json()) as RespuestaClientes;
    },
  );

  const clientes = respuesta?.data ?? [];

  // La paginación y los municipios vienen dentro de la misma respuesta.
  useEffect(() => {
    if (respuesta?.pagination) setPagination(respuesta.pagination);
    if (respuesta?.municipios) setMunicipios(respuesta.municipios);
  }, [respuesta]);

  const fetchClientes = useCallback(
    (page: number = 1) => {
      setPaginaActual(page);
      // Si la página pedida es la que ya se está viendo, el cambio de clave no
      // dispara nada: se fuerza la recarga a mano (botón "actualizar").
      if (page === paginaActual) void recargar();
    },
    [paginaActual, recargar],
  );

  const handleOpenDetails = useCallback(
    (cliente: Cliente) => {
      setSelectedCliente(cliente);
      onOpen();
    },
    [onOpen],
  );

  const handleCopy = useCallback(async (cliente: Cliente) => {
    const text = `C-${(cliente.codigo?.length || 0) > 0 ? cliente.codigo : cliente.nombre || "Sin cliente"};`;
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

  // Al cambiar un filtro se vuelve a la página 1. La petición la dispara el
  // cambio de clave de caché, no este efecto.
  useEffect(() => {
    setPaginaActual(1);
  }, [debouncedSearch, municipio, estadoCompra]);

  // El refresco por SSE y la cancelación de peticiones los gestiona el store:
  // ya no hace falta el listener ni el AbortController de este componente.

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
            placeholder="Buscar por nombre o código..."
            size="lg"
            startContent={<Icons.search className="size-5 text-default-400" />}
            value={searchValue}
            variant="bordered"
            onChange={(e) => setSearchValue(e.target.value)}
            onClear={() => setSearchValue("")}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              label="Municipio"
              size="sm"
              variant="bordered"
              selectedKeys={municipio ? [municipio] : []}
              onChange={(e) => setMunicipio(e.target.value)}
            >
              {[
                <SelectItem key="">Todos</SelectItem>,
                ...municipios.map((m) => <SelectItem key={m}>{m}</SelectItem>),
              ]}
            </Select>
            <Select
              label="Compra"
              size="sm"
              variant="bordered"
              selectedKeys={estadoCompra ? [estadoCompra] : []}
              onChange={(e) => setEstadoCompra(e.target.value)}
            >
              <SelectItem key="">Todos</SelectItem>
              <SelectItem key="Compra">Compra</SelectItem>
              <SelectItem key="No Compra">No Compra</SelectItem>
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
                        {/* Quién trajo al cliente: el vendedor de su primer
                            pedido. Sirve para saber a quién atribuirlo. */}
                        {cliente.vendedorNombre && (
                          <p className="text-xs text-default-500 mt-1">
                            Traído por{" "}
                            <span className="font-medium text-default-700">
                              {cliente.vendedorNombre}
                            </span>
                            {(cliente.otrosVendedores ?? 0) > 0 && (
                              <span className="text-default-400">
                                {" "}
                                (+{cliente.otrosVendedores} vendedor
                                {cliente.otrosVendedores === 1 ? "" : "es"} más)
                              </span>
                            )}
                          </p>
                        )}
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
        isDismissable={false}
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
                        Código: {selectedCliente.codigo}
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
                        <p className="text-xs text-default-500">Código</p>
                        <p className="font-semibold">
                          {selectedCliente?.codigo || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Datos del Consolidado de Parranda */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {selectedCliente?.direccion && (
                      <div className="p-3 rounded-lg bg-default-50 sm:col-span-2">
                        <p className="mb-1 text-xs text-default-500">Dirección</p>
                        <code className="block w-full p-2 text-sm bg-white border rounded break-all select-all">
                          {selectedCliente.direccion}
                        </code>
                      </div>
                    )}
                    {selectedCliente?.municipio && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">Municipio</p>
                        <p className="font-semibold">{selectedCliente.municipio}</p>
                      </div>
                    )}
                    {selectedCliente?.zona && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">Zona</p>
                        <p className="font-semibold">{selectedCliente.zona}</p>
                      </div>
                    )}
                    {selectedCliente?.tipoCliente && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">Tipo</p>
                        <Chip color="primary" size="sm" variant="flat">
                          {selectedCliente.tipoCliente}
                        </Chip>
                      </div>
                    )}
                    {selectedCliente?.estadoCompra && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">Estado de compra</p>
                        <Chip
                          color={
                            selectedCliente.estadoCompra.toLowerCase() === "compra"
                              ? "success"
                              : "default"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {selectedCliente.estadoCompra}
                        </Chip>
                      </div>
                    )}
                  </div>

                  {/* Geolocalización: sin ella delivery no puede cotizar el domicilio */}
                  <div className="p-3 rounded-lg bg-default-50">
                    <p className="mb-1 text-xs text-default-500">Geolocalización</p>
                    {selectedCliente?.latitud != null &&
                    selectedCliente?.longitud != null ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="p-2 text-sm bg-white border rounded select-all">
                          {selectedCliente.latitud}, {selectedCliente.longitud}
                        </code>
                        <Chip color="success" size="sm" variant="flat">
                          Se puede calcular el domicilio
                        </Chip>
                      </div>
                    ) : (
                      <Chip color="warning" size="sm" variant="flat">
                        Sin geolocalización — no se le puede calcular el domicilio
                      </Chip>
                    )}
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
