import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Input,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Select,
  SelectItem,
  Chip,
  Pagination,
  addToast,
} from "@heroui/react";
import { useEffect, useState, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn, copyTextToClipboard } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";
import { aplicarLote } from "@/hooks/aplicar-eventos";
import { getSucursalActiva } from "@/components/sucursal-selector";
import { useAuthStore } from "@/stores/authStore";
import {
  usarVendedores,
  type Vendedor,
  type Gestor,
} from "@/stores/datos/vendedores";

// Los tipos Vendedor/Gestor viven en el store: los comparten quien los pinta y
// quien los trae, y asi no se separan cuando cambie el api.

const SIN_ASIGNAR = "__sin_asignar__";

// Referencias FIJAS para cuando aun no hay datos. Si se pusiera [] en linea, seria
// un array nuevo en cada render y dispararia efectos y memos sin parar.
const VACIOS: Vendedor[] = [];
const SIN_GESTORES: Gestor[] = [];

/**
 * Trae la lista. Se lee de /vendedores/gestores (NO scopeado por sucursal) porque
 * los vendedores "sin asignar" todavia no tienen sucursal y con /vendedores no
 * apareceerian: no habria forma de enlazarlos.
 */
const traerVendedores = async (signal: AbortSignal) => {
  const r = await fetch(`${getApiBaseUrl()}/vendedores/gestores`, { signal });

  if (!r.ok) throw new Error("Error al cargar los vendedores");
  const d = await r.json();

  return {
    vendedores: d.vendedores ?? [],
    gestores: d.gestores ?? [],
    sinAsignar: d.sinAsignar ?? 0,
  };
};

interface VendedorStats {
  totalPedidos: number;
  pedidosCompletados: number;
  pedidosEnProceso: number;
  pedidosExpirados: number;
  availableYears: number[];
}

export const VendedoresList = () => {
  const { session } = useAuthStore();
  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;

  const [filteredVendedores, setFilteredVendedores] = useState<Vendedor[]>([]);
  // No hay estado de error propio: los fallos de ACCION (enlazar gestor, dar de
  // baja) se avisan con un toast, y los de CARGA los lleva el store.
  const [searchValue, setSearchValue] = useState<string>("");
  const [selectedVendedor, setSelectedVendedor] = useState<Vendedor | null>(
    null,
  );
  const [vendedorStats, setVendedorStats] = useState<VendedorStats | null>(
    null,
  );
  const [selectedYear, setSelectedYear] = useState<number>(
    new Date().getFullYear(),
  );
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [copiedVendedorId, setCopiedVendedorId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const { isOpen, onOpen, onClose } = useDisclosure();

  // La lista vive en el store, no en un useState de esta vista: asi sobrevive a la
  // navegacion y volver aqui es instantaneo en vez de costar otra vuelta al
  // servidor. La clave incluye la sucursal enfocada porque el servidor filtra por
  // ella; sin eso, cambiar de sucursal enseniaria la lista de la anterior.
  //
  // El SSE se aplica EN SITIO: el evento trae el vendedor completo (con gestor,
  // sucursal y su conteo de pedidos), asi que la tabla no parpadea. Los eventos de
  // 'usuario' si obligan a releer —cambian los gestores disponibles, que no viajan
  // en el evento—, pero de fondo.
  const {
    datos,
    cargando: isLoading,
    error: errorCarga,
    recargar: fetchVendedores,
  } = usarVendedores(`vendedores:${activeSucursalId ?? "todas"}`, traerVendedores, {
    aplicar: (actual, lote) => {
      const deVendedor = lote.filter((e) => e.tipo === "vendedor");

      if (deVendedor.length !== lote.length) return null;

      const lista = aplicarLote<Vendedor>(actual.vendedores, deVendedor, {
        alPrincipio: true,
      });

      if (lista === null) return null;
      if (lista === actual.vendedores) return actual;

      return {
        ...actual,
        vendedores: lista,
        // El contador de "sin asignar" es la razon de ser de esta vista: tiene
        // que cuadrar con lo que se esta viendo, no con lo que trajo el servidor.
        sinAsignar: lista.filter((v) => v.activo && !v.gestorId).length,
      };
    },
  });

  const vendedores = datos?.vendedores ?? VACIOS;
  const gestores = datos?.gestores ?? SIN_GESTORES;
  const sinAsignar = datos?.sinAsignar ?? 0;

  // Enlaza el vendedor a un gestor. El backend rellena la sucursal de sus pedidos
  // y clientes -> dejan de estar ocultos en la vista de pedidos.
  const handleSetGestor = useCallback(
    async (vendedor: Vendedor, gestorId: string | null) => {
      setSavingId(vendedor.id);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/vendedores/${vendedor.id}/gestor`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gestorId }),
          },
        );
        const json = await res.json();

        if (!res.ok) throw new Error(json.error || "No se pudo enlazar");

        const b = json.backfill;

        addToast({
          title: gestorId ? "Vendedor enlazado" : "Vendedor sin asignar",
          description:
            gestorId && b
              ? `Se asignaron ${b.pedidos} pedidos y ${b.clientes} clientes a la sucursal del gestor.`
              : "El vendedor quedó sin gestor: sus pedidos vuelven a ocultarse.",
          color: gestorId ? "success" : "warning",
        });
        await fetchVendedores();
      } catch (err) {
        addToast({
          title: "Error",
          description: err instanceof Error ? err.message : "Error desconocido",
          color: "danger",
        });
      } finally {
        setSavingId(null);
      }
    },
    [fetchVendedores],
  );

  // Baja/alta. La baja NO borra pedidos: solo deja de aceptarse su CSV.
  const handleSetActivo = useCallback(
    async (vendedor: Vendedor, activo: boolean) => {
      setSavingId(vendedor.id);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/vendedores/${vendedor.id}/activo`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo }),
          },
        );
        const json = await res.json();

        if (!res.ok) throw new Error(json.error || "No se pudo actualizar");

        addToast({
          title: activo ? "Vendedor reactivado" : "Vendedor dado de baja",
          description: activo
            ? "Vuelve a aceptarse su CSV de pedidos."
            : `Se dejará de aceptar su CSV. Se conservan ${json.pedidosConservados} pedidos del histórico.`,
          color: activo ? "success" : "warning",
        });
        await fetchVendedores();
      } catch (err) {
        addToast({
          title: "Error",
          description: err instanceof Error ? err.message : "Error desconocido",
          color: "danger",
        });
      } finally {
        setSavingId(null);
      }
    },
    [fetchVendedores],
  );

  const fetchVendedorStats = useCallback(
    async (vendedorId: string, year: number) => {
      setIsLoadingStats(true);
      try {
        const response = await fetch(
          `${getApiBaseUrl()}/vendedores/${vendedorId}/stats?year=${year}`
        );

        if (!response.ok) {
          throw new Error("Error al cargar estadísticas del vendedor");
        }

        const data: VendedorStats = await response.json();

        setVendedorStats(data);
      } catch (err) {
        // Error fetching vendedor stats
        void err;
      } finally {
        setIsLoadingStats(false);
      }
    },
    [],
  );

  const handleOpenDetails = useCallback(
    (vendedor: Vendedor) => {
      setSelectedVendedor(vendedor);
      setSelectedYear(new Date().getFullYear());
      setVendedorStats(null);
      fetchVendedorStats(vendedor.id, new Date().getFullYear());
      onOpen();
    },
    [onOpen, fetchVendedorStats],
  );

  const handleCopy = useCallback(async (vendedor: Vendedor) => {
    const text = `V-${vendedor.nombre};`;
    const ok = await copyTextToClipboard(text);

    if (ok) {
      setCopiedVendedorId(vendedor.id);
      setTimeout(() => setCopiedVendedorId(null), 2000);
    }
  }, []);

  const handleYearChange = useCallback(
    (year: number) => {
      setSelectedYear(year);
      if (selectedVendedor) {
        fetchVendedorStats(selectedVendedor.id, year);
      }
    },
    [selectedVendedor, fetchVendedorStats],
  );

  // Volver a la primera página al cambiar la búsqueda.
  useEffect(() => {
    setPage(1);
  }, [searchValue]);

  // Filter vendedores by search
  useEffect(() => {
    if (searchValue.trim() === "") {
      setFilteredVendedores(vendedores);
    } else {
      const search = searchValue.toLowerCase();
      const filtered = vendedores.filter(
        (v) =>
          v.nombre.toLowerCase().includes(search) ||
          (v.codigo ?? "").toLowerCase().includes(search) ||
          (v.gestor?.username ?? "").toLowerCase().includes(search),
      );

      setFilteredVendedores(filtered);
    }
  }, [searchValue, vendedores]);

  // Fetch vendedores on mount
  useEffect(() => {
    fetchVendedores();
  }, [fetchVendedores]);

  // El vendedor del modal se re-deriva de la lista para que refleje el enlace/baja
  // recién hecho (selectedVendedor es una foto del momento en que se abrió).
  const detalle = selectedVendedor
    ? (vendedores.find((v) => v.id === selectedVendedor.id) ?? selectedVendedor)
    : null;

  // Paginación en cliente: /vendedores/gestores devuelve la lista completa.
  const totalPages = Math.ceil(filteredVendedores.length / rowsPerPage) || 1;
  const paginatedVendedores = filteredVendedores.slice(
    (page - 1) * rowsPerPage,
    (page - 1) * rowsPerPage + rowsPerPage,
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Filters */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardHeader>
          <h3 className="font-bold text-lg">Filtrar</h3>
        </CardHeader>
        <CardBody className="gap-4">
          {sinAsignar > 0 && (
            <div className="p-3 text-sm border rounded-lg bg-warning-50 border-warning-200 text-warning-700">
              Hay <b>{sinAsignar}</b> vendedor{sinAsignar > 1 ? "es" : ""} sin
              gestor. Sus pedidos están <b>ocultos</b> hasta que le asignes uno;
              al asignarlo, todos sus pedidos ya subidos se asignan solos.
            </div>
          )}
          <Input
            isClearable
            placeholder="Buscar por nombre, código o gestor..."
            size="lg"
            startContent={<Icons.search className="size-5 text-default-400" />}
            value={searchValue}
            variant="bordered"
            onChange={(e) => setSearchValue(e.target.value)}
            onClear={() => setSearchValue("")}
          />
        </CardBody>
      </Card>

      {/* Cargando. `datos == null` = aun no ha llegado la primera carga; se
          excluye el caso con error para no pintar el spinner ENCIMA del aviso
          de fallo, que dejaba la pantalla girando con el error debajo sin que
          se entendiera que ya no iba a llegar nada. */}
      {(isLoading || (datos == null && !errorCarga)) && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {/* Error State */}
      {errorCarga && (
        <Card>
          <CardBody className="text-center py-6">
            <p className="text-danger">{errorCarga}</p>
            <Button
              className="mt-4"
              color="primary"
              onPress={() => fetchVendedores()}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Vendedores Table */}
      {!isLoading && !errorCarga && datos != null && (
        <>
          <Card className={cn(cards({ border: "default" }))}>
            <CardHeader>
              <h3 className="font-bold text-lg">
                Vendedores ({filteredVendedores.length})
              </h3>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-2">
                {paginatedVendedores.map((vendedor) => (
                  <div
                    key={vendedor.id}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-default-50 rounded-lg hover:bg-default-100 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <Icons.workers className="size-10 min-w-10 text-primary" />
                      <div className="min-w-0">
                        <p className="font-semibold text-lg">
                          {vendedor.nombre}
                        </p>
                        <p className="text-sm text-default-500">
                          Código: {vendedor.codigo ?? "sin código"}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {vendedor.gestorId ? (
                            <Chip color="success" size="sm" variant="flat">
                              Gestor: {vendedor.gestor?.username}
                              {vendedor.sucursal?.codigo
                                ? ` · ${vendedor.sucursal.codigo}`
                                : ""}
                            </Chip>
                          ) : (
                            <Chip color="warning" size="sm" variant="flat">
                              Sin asignar — pedidos ocultos
                            </Chip>
                          )}
                          {!vendedor.activo && (
                            <Chip color="danger" size="sm" variant="flat">
                              De baja
                            </Chip>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                      <Select
                        aria-label="Asignar gestor"
                        className="w-full sm:w-52"
                        isDisabled={
                          savingId === vendedor.id || gestores.length === 0
                        }
                        placeholder="Sin asignar"
                        selectedKeys={
                          new Set([vendedor.gestorId ?? SIN_ASIGNAR])
                        }
                        size="sm"
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const key = Array.from(keys)[0] as string | undefined;

                          if (!key || key === (vendedor.gestorId ?? SIN_ASIGNAR))
                            return;
                          handleSetGestor(
                            vendedor,
                            key === SIN_ASIGNAR ? null : key,
                          );
                        }}
                      >
                        {[
                          <SelectItem key={SIN_ASIGNAR}>Sin asignar</SelectItem>,
                          ...gestores.map((g) => (
                            <SelectItem key={g.id}>
                              {`${g.username}${g.sucursal?.codigo ? ` · ${g.sucursal.codigo}` : ""}`}
                            </SelectItem>
                          )),
                        ]}
                      </Select>
                      <div className="flex flex-row gap-2">
                        <Button
                          className="flex-1 md:flex-none"
                          color={
                            copiedVendedorId === vendedor.id
                              ? "success"
                              : "default"
                          }
                          startContent={<Icons.copy className="size-5" />}
                          variant="ghost"
                          onPress={() => handleCopy(vendedor)}
                        >
                          {copiedVendedorId === vendedor.id
                            ? "Copiado"
                            : "Copiar"}
                        </Button>
                        <Button
                          className="flex-1 md:flex-none"
                          color="primary"
                          startContent={<Icons.eye className="size-5" />}
                          variant="ghost"
                          onPress={() => handleOpenDetails(vendedor)}
                        >
                          Ver Detalles
                        </Button>
                        <Button
                          className="flex-1 md:flex-none"
                          color={vendedor.activo ? "danger" : "success"}
                          isLoading={savingId === vendedor.id}
                          variant="ghost"
                          onPress={() =>
                            handleSetActivo(vendedor, !vendedor.activo)
                          }
                        >
                          {vendedor.activo ? "Dar de baja" : "Reactivar"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Empty State */}
              {filteredVendedores.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-default-500">
                    No se encontraron vendedores con los filtros aplicados
                  </p>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex w-full justify-center mt-4">
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
                    page={page}
                    siblings={1}
                    size="lg"
                    total={totalPages}
                    onChange={(p) => setPage(p)}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Vendedor Details Modal */}
      <Modal
        isDismissable={false}
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
                  <Icons.workers className="size-8 text-primary" />
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedVendedor?.nombre}
                    </h2>
                    <p className="text-sm text-default-500">
                      Código: {selectedVendedor?.codigo}
                    </p>
                  </div>
                </div>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {/* Gestor asignado (o asignar uno) */}
                  <div className="flex flex-col gap-3 p-3 rounded-lg bg-default-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Gestor:</span>
                      {detalle?.gestorId ? (
                        <Chip color="success" size="sm" variant="flat">
                          {detalle.gestor?.username}
                          {detalle.sucursal?.codigo
                            ? ` · ${detalle.sucursal.codigo}`
                            : ""}
                        </Chip>
                      ) : (
                        <Chip color="warning" size="sm" variant="flat">
                          Sin asignar — sus pedidos están ocultos
                        </Chip>
                      )}
                      {detalle && !detalle.activo && (
                        <Chip color="danger" size="sm" variant="flat">
                          De baja
                        </Chip>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select
                        aria-label="Asignar gestor"
                        className="w-full sm:max-w-xs"
                        isDisabled={
                          !detalle ||
                          savingId === detalle.id ||
                          gestores.length === 0
                        }
                        placeholder="Sin asignar"
                        selectedKeys={
                          new Set([detalle?.gestorId ?? SIN_ASIGNAR])
                        }
                        size="sm"
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          if (!detalle) return;
                          const key = Array.from(keys)[0] as string | undefined;

                          if (!key || key === (detalle.gestorId ?? SIN_ASIGNAR))
                            return;
                          handleSetGestor(
                            detalle,
                            key === SIN_ASIGNAR ? null : key,
                          );
                        }}
                      >
                        {[
                          <SelectItem key={SIN_ASIGNAR}>Sin asignar</SelectItem>,
                          ...gestores.map((g) => (
                            <SelectItem key={g.id}>
                              {`${g.username}${g.sucursal?.codigo ? ` · ${g.sucursal.codigo}` : ""}`}
                            </SelectItem>
                          )),
                        ]}
                      </Select>

                      {detalle && (
                        <Button
                          color={detalle.activo ? "danger" : "success"}
                          isLoading={savingId === detalle.id}
                          size="sm"
                          variant="flat"
                          onPress={() => handleSetActivo(detalle, !detalle.activo)}
                        >
                          {detalle.activo ? "Dar de baja" : "Reactivar"}
                        </Button>
                      )}
                    </div>

                    {gestores.length === 0 && (
                      <p className="text-xs text-danger">
                        No hay usuarios con rol Gestor. Créalos en Usuarios y
                        asígnales su sucursal.
                      </p>
                    )}
                  </div>

                  {/* Year Selector */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">Año:</span>
                    <Select
                      className="max-w-xs"
                      selectedKeys={[selectedYear.toString()]}
                      size="sm"
                      variant="bordered"
                      onChange={(e) => {
                        const year = parseInt(e.target.value);

                        handleYearChange(year);
                      }}
                    >
                      {(vendedorStats?.availableYears || []).map((year) => (
                        <SelectItem
                          key={year.toString()}
                          textValue={year.toString()}
                        >
                          {year}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  {/* Loading Stats */}
                  {isLoadingStats && (
                    <div className="flex justify-center py-8">
                      <Spinner color="primary" />
                    </div>
                  )}

                  {/* KPIs */}
                  {!isLoadingStats && vendedorStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Card className={cn(cards({ border: "default" }))}>
                        <CardBody className="gap-2 items-center text-center">
                          <Icons.receipt className="size-8 text-primary" />
                          <p className="text-2xl font-bold">
                            {vendedorStats.totalPedidos}
                          </p>
                          <p className="text-xs text-default-500">Total</p>
                        </CardBody>
                      </Card>

                      <Card className={cn(cards({ border: "success" }))}>
                        <CardBody className="gap-2 items-center text-center">
                          <Icons.check className="size-8 text-success" />
                          <p className="text-2xl font-bold text-success">
                            {vendedorStats.pedidosCompletados}
                          </p>
                          <p className="text-xs text-default-500">
                            Completados
                          </p>
                        </CardBody>
                      </Card>

                      <Card className={cn(cards({ border: "warning" }))}>
                        <CardBody className="gap-2 items-center text-center">
                          <Icons.pedido className="size-8 text-warning" />
                          <p className="text-2xl font-bold text-warning">
                            {vendedorStats.pedidosEnProceso}
                          </p>
                          <p className="text-xs text-default-500">En Proceso</p>
                        </CardBody>
                      </Card>

                      <Card className={cn(cards({ border: "danger" }))}>
                        <CardBody className="gap-2 items-center text-center">
                          <Icons.close className="size-8 text-danger" />
                          <p className="text-2xl font-bold text-danger">
                            {vendedorStats.pedidosExpirados}
                          </p>
                          <p className="text-xs text-default-500">Expirados</p>
                        </CardBody>
                      </Card>
                    </div>
                  )}
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
