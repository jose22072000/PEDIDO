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
import { VendedorSelect } from "@/components/vendedor-select";
import { getApiBaseUrl } from "@/config";
import { usarReporte } from "@/stores/datos/reportes";
import { FRESCO_LARGO_MS } from "@/stores/crearStoreDatos";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";
import { useAuthStore } from "@/stores/authStore";

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
  totalItems: number;
  totalPacks: number;
}

interface Sucursal {
  id: string;
  nombre: string;
}

interface RespuestaReporte {
  pedidos: Pedido[];
  resumen: Resumen | null;
}

/** Lo que el usuario PIDIO al pulsar Generar. Ver el comentario del store abajo. */
interface Peticion {
  inicio: string;
  fin: string;
  sucursal: string;
  vendedorId: string;
  estado: string;
}

const SIN_PEDIDOS: Pedido[] = [];

// Peticion vacia para cuando aun no se ha generado nada: el store esta inactivo,
// asi que esta funcion nunca llega a ejecutarse, pero el tipo tiene que cuadrar.
const EMPTY_Q: Peticion = { inicio: "", fin: "", sucursal: "", vendedorId: "", estado: "" };

const claveDe = (q: Peticion) =>
  `estado:${q.sucursal}:${q.inicio}:${q.fin}:${q.vendedorId}:${q.estado}`;

const traerReporte =
  (q: Peticion, global: boolean) =>
  async (signal: AbortSignal): Promise<RespuestaReporte> => {
    const params = new URLSearchParams({
      fechaInicio: q.inicio,
      fechaFin: q.fin, vendedorId: q.vendedorId, estado: q.estado,
    });

    if (global) params.append("sucursalId", q.sucursal || "all");

    const r = await fetch(
      `${getApiBaseUrl()}/reports/pedidos-por-estado?${params.toString()}`,
      { signal },
    );

    if (!r.ok) throw new Error("Error al generar el reporte. Intenta de nuevo.");

    return r.json();
  };

export default function ReportePedidosEstadoPage() {
  const { user, session } = useAuthStore();
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [sucursalId, setSucursalId] = useState("all");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [vendedorId, setVendedorId] = useState("all");
  const [estado, setEstado] = useState("all");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(true);
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const isGlobalAdmin = Boolean(session?.isGlobalAdmin);
  const userSucursalId = user?.sucursalId || session?.sucursalId || "";

  // Falta de fechas: es un aviso de la vista, no un fallo de carga (ese lo lleva
  // el store).
  const [aviso, setAviso] = useState<string | null>(null);

  // El reporte NO se genera solo: se guarda lo que el usuario pidio al pulsar el
  // boton, y el store solo trabaja con eso. Asi cambiar un filtro no dispara una
  // agregacion pesada a medias, y la clave y la consulta nunca se desincronizan
  // (que es lo que enseniaria el reporte de otros filtros).
  const [peticion, setPeticion] = useState<Peticion | null>(null);
  const clave = peticion ? claveDe(peticion) : "";

  const {
    datos,
    cargando: isLoading,
    error,
    recargar,
  } = usarReporte<RespuestaReporte>(
    clave,
    traerReporte(peticion ?? EMPTY_Q, isGlobalAdmin),
    {
      activo: peticion !== null,
      // Un reporte es caro: volver a la vista no debe relanzarlo por haber
      // tardado medio minuto. Para rehacerlo esta el boton.
      frescoMs: FRESCO_LARGO_MS,
    },
  );

  const pedidos = datos?.pedidos ?? SIN_PEDIDOS;
  const resumen = datos?.resumen ?? null;

  const handleGenerarReporte = () => {
    if (!fechaInicio || !fechaFin) {
      setAviso("Por favor selecciona ambas fechas");

      return;
    }
    setAviso(null);
    setPage(1);

    const nueva: Peticion = {
      inicio: fechaInicio,
      fin: fechaFin,
      sucursal: sucursalId,
      vendedorId,
      estado,
    };

    // Mismos filtros otra vez: la clave no cambia y el efecto no dispararia nada.
    // El usuario ha pedido rehacerlo, se rehace.
    if (claveDe(nueva) === clave) void recargar();
    else setPeticion(nueva);
  };


  const paginatedPedidos = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return pedidos.slice(start, end);
  }, [pedidos, page]);

  const totalPages = Math.ceil(pedidos.length / rowsPerPage);

  useEffect(() => {
    fetchVendedores();
  }, [sucursalId, isGlobalAdmin]);

  useEffect(() => {
    if (isGlobalAdmin) {
      fetchSucursales();
    } else if (userSucursalId) {
      setSucursalId(userSucursalId);
    }
  }, [isGlobalAdmin, userSucursalId]);

  const fetchSucursales = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/sucursales`);
      if (response.ok) {
        const data = await response.json();
        setSucursales(data);
      }
    } catch {
      // ignore
    }
  };

  const fetchVendedores = async () => {
    try {
      const params = new URLSearchParams();
      if (isGlobalAdmin) {
        params.append("sucursalId", sucursalId || "all");
      }

      const url = params.toString()
        ? `${getApiBaseUrl()}/reports/vendedores?${params.toString()}`
        : `${getApiBaseUrl()}/reports/vendedores`;

      const response = await fetch(url);

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

  // El refresco en vivo lo lleva el store: escucha los eventos de "pedido" y,
  // como un reporte no se puede parchear con un objeto suelto, lo rehace de
  // fondo, sin vaciar la tabla ni volver al esqueleto.

  const handleExportExcel = () => {
    if (pedidos.length === 0) return;

    const dataToExport = pedidos.flatMap((pedido) =>
      pedido.items.map((item) => ({
        Folio: pedido.folio,
        Estado: getEstadoLabel(pedido.estado),
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

    const estadoLabel = estado === "all" ? "Todos" : getEstadoLabel(estado);

    exportToExcel(
      dataToExport,
      `Reporte_Estado_${estadoLabel}_${fechaInicio}_${fechaFin}`,
    );
  };

  const getEstadoLabel = (estado: string) => {
    switch (estado) {
      case "completada":
        return "Completada";
      case "en_proceso":
        return "En Proceso";
      case "expirada":
        return "Expirada";
      default:
        return estado;
    }
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="check"
        paragraph="Filtra y analiza pedidos por estado, vendedor y fecha"
        title="Reporte de Pedidos por Estado"
      />

      <Card className="mb-4">
        <CardHeader className="flex gap-3">
          <Icons.filter className="w-6 h-6 text-primary" />
          <p className="text-lg font-semibold">Filtros</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col lg:flex-row gap-4 items-end justify-between">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-1 w-full">
              {isGlobalAdmin && (
                <Select
                  items={[
                    { id: "all", nombre: "Todas las sucursales" },
                    ...sucursales,
                  ]}
                  label="Sucursal"
                  labelPlacement="outside"
                  selectedKeys={[sucursalId]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string;
                    setSucursalId(selected || "all");
                    setVendedorId("all");
                  }}
                >
                  {(item) => <SelectItem key={item.id}>{item.nombre}</SelectItem>}
                </Select>
              )}
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
              <VendedorSelect
                claveTodos="all"
                isLoading={isLoadingVendedores}
                labelPlacement="outside"
                value={vendedorId}
                vendedores={vendedores}
                onChange={setVendedorId}
              />
              <Select
                items={[
                  { id: "all", nombre: "Todos los estados" },
                  { id: "completada", nombre: "Completada" },
                  { id: "en_proceso", nombre: "En Proceso" },
                  { id: "expirada", nombre: "Expirada" },
                ]}
                label="Estado"
                labelPlacement="outside"
                placeholder="Selecciona un estado"
                selectedKeys={[estado]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;

                  setEstado(selected || "all");
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
                onPress={() => handleGenerarReporte()}
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
          {(aviso ?? error) && <p className="text-danger mt-2">{aviso ?? error}</p>}
        </CardBody>
      </Card>

      {resumen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-primary">{resumen.total}</p>
              <p className="text-sm text-default-500">Total Pedidos</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-secondary">
                {resumen.totalItems}
              </p>
              <p className="text-sm text-default-500">Total De Unidades</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-center">
              <p className="text-2xl font-bold text-warning">
                {resumen.totalPacks}
              </p>
              <p className="text-sm text-default-500">Total De Paquetes</p>
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
              aria-label="Tabla de pedidos por estado"
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
                <TableColumn>ESTADO</TableColumn>
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
                      <TableCell>{getEstadoLabel(pedido.estado)}</TableCell>
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
            <Icons.check className="w-16 h-16 mx-auto text-default-300 mb-4" />
            <p className="text-default-500">
              Selecciona los filtros y genera el reporte por estado
            </p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
