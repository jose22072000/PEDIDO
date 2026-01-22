import { useState, useEffect, useMemo } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
} from "@heroui/react";

import { NavigationHeading } from "@/components/navigation-heading";
import { getApiBaseUrl } from "@/config";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";

interface PedidoItem {
  id: string;
  producto: string;
  unidades: number;
  packs: number | null;
}

interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
}

interface Pedido {
  id: string;
  folio: string;
  fecha: string;
  fecha_comprometida: string | null;
  estado: string;
  vendedor: Vendedor | null;
  cliente: { id: string; nombre: string; codigo: string | null } | null;
  items: PedidoItem[];
}

interface Resumen {
  total: number;
  completados: number;
  enProceso: number;
  expirados: number;
  vendedores: number;
}

export default function ReportePedidosVendedorPage() {
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [vendedorId, setVendedorId] = useState("all");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;

  const paginatedPedidos = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return pedidos.slice(start, end);
  }, [pedidos, page]);

  const totalPages = Math.ceil(pedidos.length / rowsPerPage);

  useEffect(() => {
    fetchVendedores();
  }, []);

  const fetchVendedores = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/reports/vendedores`);

      if (response.ok) {
        const data = await response.json();

        setVendedores(data);
      }
    } catch (err) {
      console.error("Error fetching vendedores:", err);
    } finally {
      setIsLoadingVendedores(false);
    }
  };

  const handleGenerarReporte = async () => {
    if (!fechaInicio || !fechaFin) {
      setError("Por favor selecciona ambas fechas");

      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `${getApiBaseUrl()}/reports/pedidos-por-vendedor?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&vendedorId=${vendedorId}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Error al generar el reporte");
      }

      const data = await response.json();

      setPedidos(data.pedidos);
      setResumen(data.resumen);
      setPage(1); // Reset to first page when new data loads
    } catch (err) {
      setError("Error al generar el reporte. Intenta de nuevo.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (pedidos.length === 0) return;

    const dataToExport = pedidos.flatMap((pedido) =>
      pedido.items.map((item) => ({
        Folio: pedido.folio,
        Vendedor: pedido.vendedor?.nombre || "Sin vendedor",
        Cliente: pedido.cliente?.nombre || "Sin cliente",
        "Fecha Pedido": new Date(pedido.fecha).toLocaleDateString(),
        "Fecha Comprometida": pedido.fecha_comprometida
          ? new Date(pedido.fecha_comprometida).toLocaleDateString()
          : "N/A",
        Producto: item.producto,
        Unidades: item.unidades,
        Packs: item.packs || 0,
      })),
    );

    exportToExcel(dataToExport, `Reporte_Vendedor_${fechaInicio}_${fechaFin}`);
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="workers"
        paragraph="Analiza el rendimiento de cada vendedor por fecha"
        title="Reporte de Pedidos por Vendedor"
      />

      <Card className="mb-4">
        <CardHeader className="flex gap-3">
          <Icons.filter className="w-6 h-6 text-primary" />
          <p className="text-lg font-semibold">Filtros</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col lg:flex-row gap-4 items-end justify-between">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 w-full">
              <Input
                label="Fecha Inicio"
                labelPlacement="outside"
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
              <Input
                label="Fecha Fin"
                labelPlacement="outside"
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
              />
              <Select
                isLoading={isLoadingVendedores}
                items={[
                  { id: "all", nombre: "Todos los vendedores" },
                  ...vendedores,
                ]}
                label="Vendedor"
                labelPlacement="outside"
                placeholder="Selecciona un vendedor"
                selectedKeys={[vendedorId]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;

                  setVendedorId(selected || "all");
                }}
              >
                {(item) => <SelectItem key={item.id}>{item.nombre}</SelectItem>}
              </Select>
            </div>
            <div className="flex gap-2 w-full lg:w-auto">
              <Button
                className="flex-1 lg:flex-none"
                color="primary"
                isLoading={isLoading}
                startContent={
                  !isLoading && <Icons.search className="w-4 h-4" />
                }
                onPress={handleGenerarReporte}
              >
                Generar
              </Button>
              <Button
                className="flex-1 lg:flex-none"
                color="success"
                isDisabled={pedidos.length === 0}
                startContent={<Icons.download className="w-4 h-4" />}
                variant="bordered"
                onPress={handleExportExcel}
              >
                Excel
              </Button>
            </div>
          </div>
          {error && <p className="text-danger mt-2">{error}</p>}
        </CardBody>
      </Card>

      {resumen && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-primary">{resumen.total}</p>
              <p className="text-sm text-default-500">Total Pedidos</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-success">
                {resumen.completados}
              </p>
              <p className="text-sm text-default-500">Completados</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-warning">
                {resumen.enProceso}
              </p>
              <p className="text-sm text-default-500">En Proceso</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-danger">
                {resumen.expirados}
              </p>
              <p className="text-sm text-default-500">Expirados</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-secondary">
                {resumen.vendedores}
              </p>
              <p className="text-sm text-default-500">Vendedores</p>
            </CardBody>
          </Card>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {!isLoading && pedidos.length > 0 && (
        <Card>
          <CardBody>
            <Table
              aria-label="Pedidos por vendedor"
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
            >
              <TableHeader>
                <TableColumn>FOLIO</TableColumn>
                <TableColumn>VENDEDOR</TableColumn>
                <TableColumn>CLIENTE</TableColumn>
                <TableColumn>FECHA PEDIDO</TableColumn>
                <TableColumn>FECHA COMPROMETIDA</TableColumn>
                <TableColumn>PRODUCTO</TableColumn>
                <TableColumn>UNIDADES</TableColumn>
                <TableColumn>PACKS</TableColumn>
              </TableHeader>
              <TableBody>
                {paginatedPedidos.flatMap((pedido) =>
                  pedido.items.map((item, idx) => (
                    <TableRow key={`${pedido.id}-${idx}`}>
                      <TableCell>{pedido.folio}</TableCell>
                      <TableCell>
                        {pedido.vendedor?.nombre || "Sin vendedor"}
                      </TableCell>
                      <TableCell>
                        {pedido.cliente?.nombre || "Sin cliente"}
                      </TableCell>
                      <TableCell>
                        {new Date(pedido.fecha).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {pedido.fecha_comprometida
                          ? new Date(
                              pedido.fecha_comprometida,
                            ).toLocaleDateString()
                          : "N/A"}
                      </TableCell>
                      <TableCell>{item.producto}</TableCell>
                      <TableCell>{item.unidades}</TableCell>
                      <TableCell>{item.packs || 0}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {!isLoading && pedidos.length === 0 && resumen === null && (
        <Card>
          <CardBody className="text-center py-8">
            <Icons.workers className="w-16 h-16 mx-auto text-default-300 mb-4" />
            <p className="text-default-500">
              Selecciona las fechas y genera el reporte por vendedor
            </p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
