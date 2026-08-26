import {
  Card,
  CardBody,
  CardHeader,
  Pagination,
  Button,
  Input,
  Autocomplete,
  AutocompleteItem,
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
import { registrarCopia } from "@/lib/registrar-copia";
import { getApiBaseUrl } from "@/config";
import { getSucursalActiva } from "@/components/sucursal-selector";
import { useAuthStore } from "@/stores/authStore";
import {
  usarClientes,
  type Cliente,
  type RespuestaClientes,
} from "@/stores/datos/clientes";
import { useCerrarAlPulsarFuera } from "@/hooks/cerrar-al-pulsar-fuera";

// Los tipos viven en el store: los comparten quien los pinta y quien los trae.

/** Cuantos clientes por pagina. Fijo, asi que no hace falta llevarlo en estado. */
const POR_PAGINA = 10;

// Referencias FIJAS para cuando aun no hay datos: si se pusieran en linea serian
// objetos nuevos en cada render y dispararian efectos y memos sin parar.
const SIN_CLIENTES: Cliente[] = [];
const PAGINACION_VACIA = {
  page: 1,
  limit: POR_PAGINA,
  total: 0,
  totalPages: 1,
};

/** Los datos que se pueden echar en falta, en el orden en que estorban. */
const FALTANTES: Array<{ clave: string; etiqueta: string }> = [
  { clave: "telefono", etiqueta: "teléfono" },
  // Sin ubicación no se puede cotizar el domicilio: es la que de verdad frena trabajo.
  { clave: "geo", etiqueta: "ubicación" },
  { clave: "direccion", etiqueta: "dirección" },
  { clave: "municipio", etiqueta: "municipio" },
];

const traerClientes =
  (
    page: number,
    search: string,
    municipio: string,
    estadoCompra: string,
    vendedorId: string,
    falta: string,
  ) =>
  async (signal: AbortSignal): Promise<RespuestaClientes> => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(POR_PAGINA),
    });

    if (search.length > 0) params.append("search", search);
    if (municipio) params.append("municipio", municipio);
    if (estadoCompra) params.append("estadoCompra", estadoCompra);
    if (vendedorId) params.append("vendedorId", vendedorId);
    if (falta) params.append("falta", falta);

    const r = await fetch(`${getApiBaseUrl()}/clientes?${params}`, { signal });

    if (!r.ok) throw new Error("Error al cargar los clientes");

    return r.json();
  };

export const ClientesList = () => {
  const { session } = useAuthStore();
  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;

  // La pagina PEDIDA es estado de la vista; la paginacion REAL (total, paginas)
  // viene con los datos. Antes eran la misma variable, y por eso pedir una pagina
  // obligaba a tener ya la respuesta anterior.
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [searchValue, setSearchValue] = useState<string>("");
  const [municipio, setMunicipio] = useState<string>("");
  const [estadoCompra, setEstadoCompra] = useState<string>("");
  // Quien trajo al cliente. Los clientes los traen los vendedores, asi que
  // filtrar por vendedor es la forma natural de mirar esta lista.
  const [vendedorId, setVendedorId] = useState<string>("");
  // Qué dato falta: "", "telefono", "geo", "direccion", "municipio".
  const [falta, setFalta] = useState<string>("");
  const [vendedores, setVendedores] = useState<
    Array<{ id: string; nombre: string; clientes: number }>
  >([]);
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [copiedClienteId, setCopiedClienteId] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Pulsar fuera cierra; elegir en un desplegable NO (se dibuja fuera del modal).
  useCerrarAlPulsarFuera(isOpen, onClose);

  // Cada combinacion de pagina + filtros + sucursal se cachea por separado: la
  // clave TIENE que llevarlas todas, o se enseniarian los datos de otra consulta.
  // Volver a una pagina ya vista es instantaneo.
  //
  // Los cambios de cliente llegan siempre en bloque (importacion de CSV, sync de
  // Parranda, backfill al enlazar un gestor), asi que no hay un objeto suelto que
  // aplicar: se relee. Pero de fondo, sin esqueleto y sin borrar lo que se ve.
  const {
    datos,
    cargando: isLoading,
    error,
    recargar: fetchClientes,
  } = usarClientes(
    `clientes:${activeSucursalId ?? "todas"}:${page}:${debouncedSearch}:${municipio}:${estadoCompra}:${vendedorId}:${falta}`,
    traerClientes(page, debouncedSearch, municipio, estadoCompra, vendedorId, falta),
  );

  const clientes = datos?.data ?? SIN_CLIENTES;
  const pagination = datos?.pagination ?? PAGINACION_VACIA;
  // Los vendedores de la sucursal, con cuantos clientes trajo cada uno. Se pide
  // UNA vez por sucursal: es una lista corta y no cambia mientras se filtra.
  useEffect(() => {
    const ac = new AbortController();

    fetch(`${getApiBaseUrl()}/clientes/por-vendedor`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setVendedores(Array.isArray(v) ? v : []))
      .catch(() => {
        /* sin red o sin permiso: el desplegable se queda vacio y el resto va */
      });

    return () => ac.abort();
  }, [activeSucursalId]);

  // Al cambiar de vendedor se vuelve a la primera pagina: si no, se queda en la
  // 7 de una lista que ahora tiene 2 y parece que no hay clientes.
  useEffect(() => {
    setPage(1);
  }, [vendedorId]);

  // El api solo manda la lista de municipios en algunas respuestas: se conserva la
  // ultima que llego para que el desplegable no se vacie al pasar de pagina.
  const [municipios, setMunicipios] = useState<string[]>([]);

  useEffect(() => {
    if (datos?.municipios?.length) setMunicipios(datos.municipios);
  }, [datos]);

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
      registrarCopia({ tipo: "cliente", clienteId: cliente.id });
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

  // Al cambiar un filtro se vuelve a la primera pagina: la 7 de una busqueda no
  // significa nada en la siguiente. El store se encarga de pedir lo que falte.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, municipio, estadoCompra, falta]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Filters */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardHeader>
          <h3 className="font-bold text-lg">Filtrar</h3>
        </CardHeader>
        <CardBody className="gap-4">
          {/* Misma regla que en Vendedores: ningun control lleva etiqueta
              DENTRO, porque es lo que estira la caja y deja unos mas altos que
              otros. Todos `lg` y `radius="md"`, asi la fila se lee como una
              sola pieza. */}
          <Input
            isClearable
            label="Buscar cliente"
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
              placeholder="Todos"
              selectedKeys={municipio ? [municipio] : []}
              size="lg"
              startContent={<Icons.filter className="size-5 text-default-400" />}
              variant="bordered"
              onChange={(e) => setMunicipio(e.target.value)}
            >
              {[
                <SelectItem key="">Todos</SelectItem>,
                ...municipios.map((m) => <SelectItem key={m}>{m}</SelectItem>),
              ]}
            </Select>
            <Autocomplete
              // Con buscador: hay 82 vendedores y en una lista desplegable eso son
              // muchas vueltas de rueda para llegar a uno. Escribir tres letras es
              // lo que ya se hace con los productos, aquí igual.
              defaultItems={[
                { id: "", nombre: "Todos los vendedores", clientes: null },
                ...vendedores,
              ]}
              label="Vendedor"
              placeholder="Todos los vendedores"
              selectedKey={vendedorId}
              size="lg"
              startContent={<Icons.user className="size-5 text-default-400" />}
              variant="bordered"
              onSelectionChange={(k) => setVendedorId((k as string) ?? "")}
            >
              {(v: { id: string; nombre: string; clientes: number | null }) => (
                // El numero al lado responde de un vistazo "cuantos clientes
                // tiene cada uno", que es para lo que se pidio esto.
                <AutocompleteItem key={v.id} textValue={v.nombre}>
                  {v.nombre}
                  {v.clientes != null ? ` · ${v.clientes}` : ""}
                </AutocompleteItem>
              )}
            </Autocomplete>
            <Select
              label="Compra"
              placeholder="Todos"
              selectedKeys={estadoCompra ? [estadoCompra] : []}
              size="lg"
              variant="bordered"
              onChange={(e) => setEstadoCompra(e.target.value)}
            >
              <SelectItem key="">Todos</SelectItem>
              <SelectItem key="Compra">Compra</SelectItem>
              <SelectItem key="No Compra">No Compra</SelectItem>
            </Select>
          </div>
          {/*
            Filtros por DATO QUE FALTA.
            Van como fichas y no como otro desplegable a propósito: aquí el número ES
            la información. "sin teléfono: 812" ya responde solo, sin tener que abrir
            nada — y si sale 0, la ficha se apaga en vez de esconderse, para que se vea
            que se comprobó y no hay ninguno.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-default-500">Les falta:</span>
            {FALTANTES.map((f) => {
              const n = datos?.faltantes?.[f.clave] ?? 0;
              const activo = falta === f.clave;

              return (
                <Chip
                  key={f.clave}
                  className={n === 0 && !activo ? "opacity-50" : "cursor-pointer"}
                  color={activo ? "primary" : "default"}
                  variant={activo ? "solid" : "flat"}
                  onClick={() => setFalta(activo ? "" : f.clave)}
                >
                  {f.etiqueta}: {n}
                </Chip>
              );
            })}
            {falta ? (
              <Button size="sm" variant="light" onPress={() => setFalta("")}>
                Quitar filtro
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* Loading State */}
      {(isLoading || (datos == null && !error)) && (
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
              onPress={() => fetchClientes()}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Clientes List */}
      {!isLoading && !error && datos != null && (
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
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip
                            className="border-primary [&>span]:text-primary [&>span]:font-bold w-fit"
                            color="primary"
                            size="sm"
                            variant="dot"
                          >
                            {cliente.codigo || "N/A"}
                          </Chip>
                          {/* Quién trajo al cliente: el vendedor de su pedido más
                              antiguo. No hay relación directa cliente->vendedor;
                              el api la resuelve mirando los pedidos. */}
                          {cliente.vendedorNombre && (
                            <Chip
                              className="w-fit"
                              size="sm"
                              startContent={
                                <Icons.user className="size-3.5 ml-1" />
                              }
                              title={
                                cliente.otrosVendedores
                                  ? `Lo trajo ${cliente.vendedorNombre}. Le han hecho pedidos ${cliente.otrosVendedores} vendedor(es) más.`
                                  : `Lo trajo ${cliente.vendedorNombre}`
                              }
                              variant="flat"
                            >
                              {cliente.vendedorNombre}
                              {cliente.otrosVendedores
                                ? ` +${cliente.otrosVendedores}`
                                : ""}
                            </Chip>
                          )}
                        </div>
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
                onChange={setPage}
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
                    {/*
                      El teléfono sale del pedido más reciente que traiga uno. Se enseña
                      SIEMPRE, aunque esté vacío, al revés que los demás campos: aquí
                      "no tenemos su número" es justo lo que se viene a mirar, y un
                      hueco que desaparece no se distingue de uno que nadie miró.
                    */}
                    <div className="p-3 rounded-lg bg-default-50">
                      <p className="mb-1 text-xs text-default-500">Teléfono</p>
                      {selectedCliente?.telefono ? (
                        <code className="block w-full p-2 text-sm bg-white border rounded select-all">
                          {selectedCliente.telefono}
                        </code>
                      ) : (
                        <p className="text-sm text-default-400">no lo tenemos</p>
                      )}
                    </div>
                    {/*
                      Todo lo que manda Parranda en el consolidado, aunque esté vacío.
                      Antes sólo se enseñaba lo que tenía valor, y eso hacía imposible
                      distinguir "Parranda no lo manda" de "está vacío para este
                      cliente" — que es justo lo que hay que saber para arreglarlo.
                    */}
                    {selectedCliente?.sucursalNombre && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">
                          Provincia / Sucursal
                        </p>
                        <p className="font-semibold">
                          {selectedCliente.sucursalNombre}
                          {selectedCliente.sucursalCodigo
                            ? ` (${selectedCliente.sucursalCodigo})`
                            : ""}
                        </p>
                      </div>
                    )}
                    {selectedCliente?.geolocalizacion && (
                      <div className="p-3 rounded-lg bg-default-50 sm:col-span-2">
                        <p className="mb-1 text-xs text-default-500">
                          Geolocalización (cruda de Parranda)
                        </p>
                        <code className="block w-full p-2 text-sm bg-white border rounded break-all select-all">
                          {selectedCliente.geolocalizacion}
                        </code>
                      </div>
                    )}
                    {selectedCliente?.distanciaKm != null && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">
                          Distancia al almacén
                        </p>
                        <p className="font-semibold">
                          {selectedCliente.distanciaKm.toFixed(2)} km
                        </p>
                        {/* Desde dónde se midió: sin esto el número no dice nada, porque
                            si el almacén cambia de sitio la distancia queda mal y no
                            habría forma de saber cuáles hay que rehacer. */}
                        {selectedCliente.distanciaDesde && (
                          <p className="text-xs text-default-400">
                            medida desde {selectedCliente.distanciaDesde}
                          </p>
                        )}
                      </div>
                    )}
                    {selectedCliente?.geoFuente && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">
                          Origen de la ubicación
                        </p>
                        <p className="font-semibold">
                          {selectedCliente.geoFuente === "apk"
                            ? "corregida en delivery-apk"
                            : selectedCliente.geoFuente}
                        </p>
                      </div>
                    )}
                    {selectedCliente?.direccion && (
                      <div className="p-3 rounded-lg bg-default-50 sm:col-span-2">
                        <p className="mb-1 text-xs text-default-500">
                          Dirección
                        </p>
                        <code className="block w-full p-2 text-sm bg-white border rounded break-all select-all">
                          {selectedCliente.direccion}
                        </code>
                      </div>
                    )}
                    {selectedCliente?.municipio && (
                      <div className="p-3 rounded-lg bg-default-50">
                        <p className="mb-1 text-xs text-default-500">
                          Municipio
                        </p>
                        <p className="font-semibold">
                          {selectedCliente.municipio}
                        </p>
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
                        <p className="mb-1 text-xs text-default-500">
                          Estado de compra
                        </p>
                        <Chip
                          color={
                            selectedCliente.estadoCompra.toLowerCase() ===
                            "compra"
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
                    <p className="mb-1 text-xs text-default-500">
                      Geolocalización
                    </p>
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
                        Sin geolocalización — no se le puede calcular el
                        domicilio
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
