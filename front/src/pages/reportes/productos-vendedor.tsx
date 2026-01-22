import { useState, useEffect } from "react";
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
  Tabs,
  Tab,
} from "@heroui/react";

import { NavigationHeading } from "@/components/navigation-heading";
import { getApiBaseUrl } from "@/config";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";

interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
}

interface ProductoResumen {
  producto: string;
  totalUnidades: number;
  totalPacks: number;
  pedidosCount: number;
}

interface VendedorProductos {
  vendedor: Vendedor | null;
  productos: ProductoResumen[];
  totalUnidades: number;
  totalPacks: number;
  totalPedidos: number;
}

interface Resumen {
  totalPedidos: number;
  totalVendedores: number;
  totalProductosTipos: number;
  totalUnidades: number;
  totalPacks: number;
}

export default function ReporteProductosVendedorPage() {
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [vendedorId, setVendedorId] = useState("all");
  const [estado, setEstado] = useState("all");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [porVendedor, setPorVendedor] = useState<VendedorProductos[]>([]);
  const [productosGlobal, setProductosGlobal] = useState<ProductoResumen[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("global");

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
      // Error fetching vendedores silently ignored
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
      const url = `${getApiBaseUrl()}/reports/productos-por-vendedor?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&vendedorId=${vendedorId}&estado=${estado}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Error al generar el reporte");
      }

      const data = await response.json();

      setPorVendedor(data.porVendedor);
      setProductosGlobal(data.productosGlobal);
      setResumen(data.resumen);
    } catch (err) {
      setError("Error al generar el reporte. Intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcelGlobal = () => {
    if (productosGlobal.length === 0) return;

    const dataToExport = productosGlobal.map((producto) => ({
      Producto: producto.producto,
      "Total Unidades": producto.totalUnidades,
      "Total Packs": producto.totalPacks,
      "Cantidad de Pedidos": producto.pedidosCount,
    }));

    exportToExcel(
      dataToExport,
      `Reporte_Productos_Global_${fechaInicio}_${fechaFin}`,
    );
  };

  const handleExportExcelPorVendedor = () => {
    if (porVendedor.length === 0) return;

    const dataToExport = porVendedor.flatMap((vendedorData) =>
      vendedorData.productos.map((producto) => ({
        Vendedor: vendedorData.vendedor?.nombre || "Sin vendedor",
        Producto: producto.producto,
        "Total Unidades": producto.totalUnidades,
        "Total Packs": producto.totalPacks,
        "Cantidad de Pedidos": producto.pedidosCount,
      })),
    );

    exportToExcel(
      dataToExport,
      `Reporte_Productos_Por_Vendedor_${fechaInicio}_${fechaFin}`,
    );
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="productos"
        paragraph="Analiza las sumas totales por tipo de producto y vendedor"
        title="Reporte de Productos por Vendedor"
      />

      <Card className="mb-4">
        <CardHeader className="flex gap-3">
          <Icons.filter className="w-6 h-6 text-primary" />
          <p className="text-lg font-semibold">Filtros</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col lg:flex-row gap-4 items-end justify-between">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1 w-full">
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
              <Select
                label="Estado"
                labelPlacement="outside"
                placeholder="Selecciona un estado"
                selectedKeys={[estado]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;

                  setEstado(selected || "all");
                }}
              >
                <SelectItem key="all">Todos los estados</SelectItem>
                <SelectItem key="completada">Completados</SelectItem>
                <SelectItem key="en_proceso">En Proceso</SelectItem>
                <SelectItem key="expirada">Expirados</SelectItem>
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
            </div>
          </div>
          {error && <p className="text-danger mt-2">{error}</p>}
        </CardBody>
      </Card>

      {resumen && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-primary">
                {resumen.totalPedidos}
              </p>
              <p className="text-sm text-default-500">Total Pedidos</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-secondary">
                {resumen.totalVendedores}
              </p>
              <p className="text-sm text-default-500">Vendedores</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-warning">
                {resumen.totalProductosTipos}
              </p>
              <p className="text-sm text-default-500">Tipos de Producto</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-success">
                {resumen.totalUnidades.toLocaleString()}
              </p>
              <p className="text-sm text-default-500">Total Unidades</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-danger">
                {resumen.totalPacks.toLocaleString()}
              </p>
              <p className="text-sm text-default-500">Total Packs</p>
            </CardBody>
          </Card>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {!isLoading && productosGlobal.length > 0 && (
        <Card>
          <CardBody>
            <Tabs
              aria-label="Opciones de vista"
              className="mb-4"
              selectedKey={activeTab}
              onSelectionChange={(key) => setActiveTab(key as string)}
            >
              <Tab
                key="global"
                title={
                  <div className="flex items-center gap-2">
                    <Icons.productos className="w-4 h-4" />
                    <span>Resumen Global</span>
                  </div>
                }
              />
              <Tab
                key="vendedor"
                title={
                  <div className="flex items-center gap-2">
                    <Icons.workers className="w-4 h-4" />
                    <span>Por Vendedor</span>
                  </div>
                }
              />
            </Tabs>

            {activeTab === "global" && (
              <>
                <div className="flex justify-end mb-4">
                  <Button
                    color="success"
                    isDisabled={productosGlobal.length === 0}
                    startContent={<Icons.download className="w-4 h-4" />}
                    variant="bordered"
                    onPress={handleExportExcelGlobal}
                  >
                    Exportar Excel
                  </Button>
                </div>
                <Table aria-label="Resumen global de productos">
                  <TableHeader>
                    <TableColumn>PRODUCTO</TableColumn>
                    <TableColumn>TOTAL UNIDADES</TableColumn>
                    <TableColumn>TOTAL PACKS</TableColumn>
                    <TableColumn>CANTIDAD DE PEDIDOS</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {productosGlobal.map((producto, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {producto.producto}
                        </TableCell>
                        <TableCell>
                          {producto.totalUnidades.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {producto.totalPacks.toLocaleString()}
                        </TableCell>
                        <TableCell>{producto.pedidosCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}

            {activeTab === "vendedor" && (
              <>
                <div className="flex justify-end mb-4">
                  <Button
                    color="success"
                    isDisabled={porVendedor.length === 0}
                    startContent={<Icons.download className="w-4 h-4" />}
                    variant="bordered"
                    onPress={handleExportExcelPorVendedor}
                  >
                    Exportar Excel
                  </Button>
                </div>
                <div className="space-y-6">
                  {porVendedor.map((vendedorData, idx) => (
                    <Card key={idx} className="border border-default-200">
                      <CardHeader className="bg-default-100">
                        <div className="flex flex-col md:flex-row md:items-center justify-between w-full gap-2">
                          <div className="flex items-center gap-2">
                            <Icons.workers className="w-5 h-5 text-primary" />
                            <span className="font-semibold">
                              {vendedorData.vendedor?.nombre || "Sin vendedor"}
                            </span>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <span>
                              <strong className="text-primary">
                                {vendedorData.totalPedidos}
                              </strong>{" "}
                              pedidos
                            </span>
                            <span>
                              <strong className="text-success">
                                {vendedorData.totalUnidades.toLocaleString()}
                              </strong>{" "}
                              unidades
                            </span>
                            <span>
                              <strong className="text-warning">
                                {vendedorData.totalPacks.toLocaleString()}
                              </strong>{" "}
                              packs
                            </span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardBody>
                        <Table
                          removeWrapper
                          aria-label={`Productos de ${vendedorData.vendedor?.nombre}`}
                        >
                          <TableHeader>
                            <TableColumn>PRODUCTO</TableColumn>
                            <TableColumn>UNIDADES</TableColumn>
                            <TableColumn>PACKS</TableColumn>
                            <TableColumn>PEDIDOS</TableColumn>
                          </TableHeader>
                          <TableBody>
                            {vendedorData.productos.map((producto, prodIdx) => (
                              <TableRow key={prodIdx}>
                                <TableCell>{producto.producto}</TableCell>
                                <TableCell>
                                  {producto.totalUnidades.toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  {producto.totalPacks.toLocaleString()}
                                </TableCell>
                                <TableCell>{producto.pedidosCount}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {!isLoading && productosGlobal.length === 0 && resumen === null && (
        <Card>
          <CardBody className="text-center py-8">
            <Icons.productos className="w-16 h-16 mx-auto text-default-300 mb-4" />
            <p className="text-default-500">
              Selecciona las fechas y genera el reporte de productos por
              vendedor
            </p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
