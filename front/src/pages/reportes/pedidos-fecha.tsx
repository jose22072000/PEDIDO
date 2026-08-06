import { useEffect, useState, useMemo } from "react";
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
import { usarReporte } from "@/stores/datos/reportes";
import { FRESCO_LARGO_MS } from "@/stores/crearStoreDatos";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";
import { useAuthStore } from "@/stores/authStore";
import { esFechaEnviable } from "@/lib/fecha-enviable";

interface PedidoItem {
  id: string;
  producto: string;
  unidades: number;
  packs: number | null;
}

interface Pedido {
  id: string;
  folio: string;
  fecha: string;
  fecha_comprometida: string | null;
  estado: string;
  direccion: string | null;
  encargado: string | null;
  telefono: string | null;
  vendedor: { id: string; nombre: string; codigo: string | null } | null;
  cliente: { id: string; nombre: string; codigo: string | null } | null;
  items: PedidoItem[];
}

interface Resumen {
  total: number;
  completados: number;
  enProceso: number;
  expirados: number;
  totalItems: number;
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
}

const SIN_PEDIDOS: Pedido[] = [];

// Peticion vacia para cuando aun no se ha generado nada: el store esta inactivo,
// asi que esta funcion nunca llega a ejecutarse, pero el tipo tiene que cuadrar.
const EMPTY_Q: Peticion = { inicio: "", fin: "", sucursal: "" };

const traerReporte =
  (q: Peticion, global: boolean) =>
  async (signal: AbortSignal): Promise<RespuestaReporte> => {
    if (!esFechaEnviable(q.inicio) || !esFechaEnviable(q.fin)) {
      throw new Error("Revisa las fechas: tienen que ser AAAA-MM-DD.");
    }
    const params = new URLSearchParams({ fechaInicio: q.inicio, fechaFin: q.fin });

    if (global) params.append("sucursalId", q.sucursal || "all");

    const r = await fetch(
      `${getApiBaseUrl()}/reports/pedidos-por-fecha?${params}`,
      { signal },
    );

    if (!r.ok) throw new Error("Error al generar el reporte. Intenta de nuevo.");

    return r.json();
  };

export default function ReportePedidosFechaPage() {
  const { user, session } = useAuthStore();
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("all");
  // Falta de fechas: es un aviso de la vista, no un fallo de carga (ese lo lleva
  // el store).
  const [aviso, setAviso] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const isGlobalAdmin = Boolean(session?.isGlobalAdmin);
  const userSucursalId = user?.sucursalId || session?.sucursalId || "";

  // El reporte NO se genera solo: se guarda lo que el usuario pidio al pulsar el
  // boton, y el store solo trabaja con eso. Asi cambiar una fecha no dispara una
  // agregacion pesada a medio escribir, y la clave y la consulta nunca se
  // desincronizan (que es lo que enseniaria el reporte de otro rango).
  const [peticion, setPeticion] = useState<Peticion | null>(null);
  const clave = peticion
    ? `fecha:${peticion.sucursal}:${peticion.inicio}:${peticion.fin}`
    : "";

  const {
    datos,
    cargando: isLoading,
    error,
    recargar,
  } = usarReporte<RespuestaReporte>(clave, traerReporte(peticion ?? EMPTY_Q, isGlobalAdmin), {
    activo: peticion !== null,
    // Un reporte es caro: volver a la vista no debe relanzarlo por haber tardado
    // medio minuto. Para rehacerlo esta el boton.
    frescoMs: FRESCO_LARGO_MS,
  });

  const pedidos = datos?.pedidos ?? SIN_PEDIDOS;
  const resumen = datos?.resumen ?? null;

  const handleGenerarReporte = () => {
    if (!fechaInicio || !fechaFin) {
      setAviso("Por favor selecciona ambas fechas");

      return;
    }
    setAviso(null);
    setPage(1);

    const nueva: Peticion = { inicio: fechaInicio, fin: fechaFin, sucursal: sucursalId };
    const claveNueva = `fecha:${nueva.sucursal}:${nueva.inicio}:${nueva.fin}`;

    // Mismo rango otra vez: la clave no cambia, asi que el efecto no dispararia
    // nada. El usuario ha pedido rehacerlo, se rehace.
    if (claveNueva === clave) void recargar();
    else setPeticion(nueva);
  };

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

  const paginatedPedidos = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return pedidos.slice(start, end);
  }, [pedidos, page]);

  const totalPages = Math.ceil(pedidos.length / rowsPerPage);

  // El refresco en vivo lo lleva el store: escucha los eventos de "pedido" y, como
  // un reporte no se puede parchear con un objeto suelto, lo rehace de fondo —sin
  // vaciar la tabla ni volver al esqueleto—. Durante una importacion esto pasaba
  // decenas de veces por minuto y dejaba el reporte parpadeando.

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

    exportToExcel(dataToExport, `Reporte_Pedidos_${fechaInicio}_${fechaFin}`);
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="calendar"
        paragraph="Consulta todos los pedidos en un rango de fechas específico"
        title="Reporte de Pedidos por Fecha"
      />

      <Card className="mb-4">
        <CardHeader className="flex gap-3">
          <Icons.filter className="w-6 h-6 text-primary" />
          <p className="text-lg font-semibold">Filtros</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col lg:flex-row gap-4 items-end justify-between">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 w-full">
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
                {resumen.totalItems}
              </p>
              <p className="text-sm text-default-500">Total De Unidades</p>
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
              aria-label="Tabla de pedidos por fecha"
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
            <Icons.calendar className="w-16 h-16 mx-auto text-default-300 mb-4" />
            <p className="text-default-500">
              Selecciona un rango de fechas y genera el reporte
            </p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
