import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardBody,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Spinner,
} from "@heroui/react";

import { NavigationHeading } from "@/components/navigation-heading";
import { useSucursalStore } from "@/stores/entityStores";
import { useTrabajadorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

export default function ReportesSucursalPage() {
  const {
    items: sucursales,
    loadAll: loadSucursales,
    isLoading: loadingSucursales,
  } = useSucursalStore();
  const {
    items: trabajadores,
    loadAll: loadTrabajadores,
    isLoading: loadingTrabajadores,
  } = useTrabajadorStore();
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    loadSucursales();
    loadTrabajadores();
  }, [loadSucursales, loadTrabajadores]);

  const reportData = useMemo(() => {
    return sucursales.map((sucursal) => {
      const trabajadoresSucursal = trabajadores.filter(
        (t) => t.sucursalId === sucursal.id,
      );

      return {
        ...sucursal,
        totalTrabajadores: trabajadoresSucursal.length,
        trabajadoresActivos: trabajadoresSucursal.filter((t) => t.activo)
          .length,
      };
    });
  }, [sucursales, trabajadores]);

  const estadisticas = useMemo(() => {
    const totalSucursales = sucursales.length;
    const sucursalesActivas = sucursales.filter((s) => s.activo).length;
    const totalTrabajadores = trabajadores.length;

    return {
      totalSucursales,
      sucursalesActivas,
      sucursalesInactivas: totalSucursales - sucursalesActivas,
      totalTrabajadores,
      promedioTrabajadores:
        totalSucursales > 0
          ? (totalTrabajadores / totalSucursales).toFixed(1)
          : "0",
    };
  }, [sucursales, trabajadores]);

  const handleExport = () => {
    setIsExporting(true);
    try {
      // Crear CSV
      const headers = [
        "Código",
        "Nombre",
        "Ciudad",
        "Estado",
        "Trabajadores",
        "Trabajadores Activos",
      ];
      const rows = reportData.map((s) => [
        s.codigo,
        s.nombre,
        s.ciudad,
        s.activo ? "Activa" : "Inactiva",
        s.totalTrabajadores.toString(),
        s.trabajadoresActivos.toString(),
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.join(",")),
      ].join("\n");

      // Descargar archivo
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);

      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `reporte_sucursales_${new Date().toISOString().split("T")[0]}.csv`,
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error al exportar:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const isLoading = loadingSucursales || loadingTrabajadores;

  return (
    <section className="flex flex-col gap-6 p-4">
      <NavigationHeading
        cta={{ href: "/panel/panel-sucursal", label: "Volver a Sucursales" }}
        icon="reports"
        paragraph="Visualiza estadísticas y reportes de todas las sucursales"
        title="Reportes de Sucursales"
      />

      {/* Estadísticas Generales */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-6">
            <span className="text-3xl font-bold text-primary">
              {estadisticas.totalSucursales}
            </span>
            <span className="text-sm text-default-500">Total Sucursales</span>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col items-center justify-center py-6">
            <span className="text-3xl font-bold text-success">
              {estadisticas.sucursalesActivas}
            </span>
            <span className="text-sm text-default-500">Activas</span>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col items-center justify-center py-6">
            <span className="text-3xl font-bold text-danger">
              {estadisticas.sucursalesInactivas}
            </span>
            <span className="text-sm text-default-500">Inactivas</span>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col items-center justify-center py-6">
            <span className="text-3xl font-bold text-primary">
              {estadisticas.totalTrabajadores}
            </span>
            <span className="text-sm text-default-500">Total Trabajadores</span>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col items-center justify-center py-6">
            <span className="text-3xl font-bold text-secondary">
              {estadisticas.promedioTrabajadores}
            </span>
            <span className="text-sm text-default-500">
              Promedio por Sucursal
            </span>
          </CardBody>
        </Card>
      </div>

      {/* Tabla de Sucursales */}
      <Card>
        <CardBody>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Detalle de Sucursales</h3>
            <Button
              color="primary"
              isLoading={isExporting}
              startContent={<Icons.download className="size-5" />}
              variant="flat"
              onPress={handleExport}
            >
              Exportar CSV
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Spinner size="lg" />
            </div>
          ) : (
            <Table aria-label="Tabla de sucursales">
              <TableHeader>
                <TableColumn>CÓDIGO</TableColumn>
                <TableColumn>NOMBRE</TableColumn>
                <TableColumn>CIUDAD</TableColumn>
                <TableColumn>ESTADO</TableColumn>
                <TableColumn>TRABAJADORES</TableColumn>
                <TableColumn>ACTIVOS</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No hay sucursales registradas">
                {reportData.map((sucursal) => (
                  <TableRow key={sucursal.id}>
                    <TableCell>{sucursal.codigo}</TableCell>
                    <TableCell>{sucursal.nombre}</TableCell>
                    <TableCell>{sucursal.ciudad}</TableCell>
                    <TableCell>
                      <Chip
                        color={sucursal.activo ? "success" : "danger"}
                        size="sm"
                        variant="flat"
                      >
                        {sucursal.activo ? "Activa" : "Inactiva"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip color="primary" size="sm" variant="flat">
                        {sucursal.totalTrabajadores}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip color="success" size="sm" variant="flat">
                        {sucursal.trabajadoresActivos}
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
