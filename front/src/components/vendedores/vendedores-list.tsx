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
} from "@heroui/react";
import { useEffect, useState, useCallback } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";

interface Vendedor {
  id: string;
  nombre: string;
  codigo: string;
  createdAt: string;
}

interface VendedorStats {
  totalPedidos: number;
  pedidosCompletados: number;
  pedidosEnProceso: number;
  pedidosExpirados: number;
  availableYears: number[];
}

export const VendedoresList = () => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [filteredVendedores, setFilteredVendedores] = useState<Vendedor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const { isOpen, onOpen, onClose } = useDisclosure();

  const fetchVendedores = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/vendedores`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Error al cargar los vendedores");
      }

      const data: Vendedor[] = await response.json();

      setVendedores(data);
      setFilteredVendedores(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchVendedorStats = useCallback(
    async (vendedorId: string, year: number) => {
      setIsLoadingStats(true);
      try {
        const response = await fetch(
          `${getApiBaseUrl()}/vendedores/${vendedorId}/stats?year=${year}`,
          {
            credentials: "include",
          },
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

  const handleCopy = useCallback((vendedor: Vendedor) => {
    const text = `V-${vendedor.nombre};`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedVendedorId(vendedor.id);
      setTimeout(() => setCopiedVendedorId(null), 2000);
    });
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

  // Filter vendedores by search
  useEffect(() => {
    if (searchValue.trim() === "") {
      setFilteredVendedores(vendedores);
    } else {
      const search = searchValue.toLowerCase();
      const filtered = vendedores.filter(
        (v) =>
          v.nombre.toLowerCase().includes(search) ||
          v.codigo.toLowerCase().includes(search),
      );

      setFilteredVendedores(filtered);
    }
  }, [searchValue, vendedores]);

  // Fetch vendedores on mount
  useEffect(() => {
    fetchVendedores();
  }, [fetchVendedores]);

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
              onPress={() => fetchVendedores()}
            >
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Vendedores Table */}
      {!isLoading && !error && (
        <>
          <Card className={cn(cards({ border: "default" }))}>
            <CardHeader>
              <h3 className="font-bold text-lg">
                Vendedores ({filteredVendedores.length})
              </h3>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-2">
                {filteredVendedores.map((vendedor) => (
                  <div
                    key={vendedor.id}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-default-50 rounded-lg hover:bg-default-100 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <Icons.workers className="size-10 min-w-10 text-primary" />
                      <div>
                        <p className="font-semibold text-lg">
                          {vendedor.nombre}
                        </p>
                        <p className="text-sm text-default-500">
                          Código: {vendedor.codigo}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-row gap-2 w-full md:w-auto">
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
            </CardBody>
          </Card>
        </>
      )}

      {/* Vendedor Details Modal */}
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
