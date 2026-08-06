import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Spinner,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/react";

import { NavigationHeading } from "@/components/navigation-heading";
import { getApiBaseUrl } from "@/config";
import { mostrarUsuario } from "@/lib/nombre-usuario";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";

/**
 * Cuántas veces se ha usado el botón de copiar al portapapeles.
 *
 * Sirve para medir el único paso MANUAL del circuito: la operadora copia
 * `P-folio; V-vendedor; C-cliente;` y lo pega en la observación de la factura de
 * AxisPos. Un pedido solo se puede dar por facturado si su folio aparece en esa
 * observación, así que quien no pega el código deja sus pedidos como "no
 * convertidos" aunque los haya facturado todos.
 *
 * De ahí que el número que manda sea el de tipo **pedido**: los de vendedor y
 * cliente se copian para otras cosas y se cuentan aparte para no inflarlo.
 */

interface Resumen {
  total: number;
  pedidos: number;
  porTipo: Record<string, number>;
  porUsuario: Array<{ username: string; copias: number }>;
  porSucursal: Array<{
    sucursalId: string | null;
    nombre: string;
    copias: number;
  }>;
  porDia: Array<{ dia: string; copias: number }>;
}

const hoy = () => new Date().toISOString().slice(0, 10);
const haceUnMes = () => {
  const d = new Date();

  d.setMonth(d.getMonth() - 1);

  return d.toISOString().slice(0, 10);
};

export default function CopiasPortapapelesPage() {
  const [desde, setDesde] = useState(haceUnMes());
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams({ desde, hasta });
      const r = await fetch(
        `${getApiBaseUrl()}/copias/resumen?${q.toString()}`,
      );

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));

        throw new Error(j.error || "No se pudo cargar el resumen");
      }
      setDatos(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const exportar = () => {
    if (!datos) return;
    exportToExcel(
      datos.porUsuario.map((u) => ({
        Usuario: mostrarUsuario(u.username),
        Copias: u.copias,
      })),
      `uso-portapapeles-${desde}-a-${hasta}`,
    );
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="reports"
        paragraph="Veces que se copió el código para pegarlo en la factura"
        title="Uso del portapapeles"
      />

      <Card>
        <CardHeader className="flex gap-3">
          <h3 className="font-bold text-lg">Periodo</h3>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col lg:flex-row gap-4 items-end">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 w-full">
              <Input
                label="Desde"
                labelPlacement="outside"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
              <Input
                label="Hasta"
                labelPlacement="outside"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                color="primary"
                isLoading={cargando}
                startContent={<Icons.search className="size-4" />}
                onPress={cargar}
              >
                Consultar
              </Button>
              <Button
                isDisabled={!datos || !datos.porUsuario.length}
                variant="flat"
                onPress={exportar}
              >
                Exportar
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {cargando && !datos && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {error && (
        <Card>
          <CardBody className="text-center py-6">
            <p className="text-danger">{error}</p>
          </CardBody>
        </Card>
      )}

      {datos && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* El primero es el que importa: es el que se pega en la factura. */}
            <Card>
              <CardBody className="text-center">
                <p className="text-3xl font-bold text-primary">
                  {datos.pedidos}
                </p>
                <p className="text-sm text-default-500">
                  Códigos de pedido copiados
                </p>
                <p className="text-xs text-default-400 mt-1">
                  Los que se pegan en la observación de la factura
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center">
                <p className="text-3xl font-bold">
                  {datos.porTipo.vendedor ?? 0}
                </p>
                <p className="text-sm text-default-500">Vendedores copiados</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center">
                <p className="text-3xl font-bold">
                  {datos.porTipo.cliente ?? 0}
                </p>
                <p className="text-sm text-default-500">Clientes copiados</p>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <h3 className="font-bold">Por sucursal</h3>
              </CardHeader>
              <CardBody>
                <Table removeWrapper aria-label="Copias por sucursal">
                  <TableHeader>
                    <TableColumn>SUCURSAL</TableColumn>
                    <TableColumn align="end">COPIAS</TableColumn>
                  </TableHeader>
                  <TableBody emptyContent="Todavía no se ha copiado nada en este periodo.">
                    {[...datos.porSucursal]
                      .sort((a, b) => b.copias - a.copias)
                      .map((s) => (
                        <TableRow key={s.sucursalId ?? "sin"}>
                          <TableCell>{s.nombre}</TableCell>
                          <TableCell className="text-right font-mono">
                            {s.copias}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="font-bold">Quién lo usa</h3>
              </CardHeader>
              <CardBody>
                <Table removeWrapper aria-label="Copias por usuario">
                  <TableHeader>
                    <TableColumn>USUARIO</TableColumn>
                    <TableColumn align="end">COPIAS</TableColumn>
                  </TableHeader>
                  <TableBody emptyContent="Todavía no se ha copiado nada en este periodo.">
                    {datos.porUsuario.map((u) => (
                      <TableRow key={u.username}>
                        <TableCell>{mostrarUsuario(u.username)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {u.copias}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h3 className="font-bold">Por día</h3>
            </CardHeader>
            <CardBody>
              <Table removeWrapper aria-label="Copias por día">
                <TableHeader>
                  <TableColumn>DÍA</TableColumn>
                  <TableColumn align="end">COPIAS</TableColumn>
                </TableHeader>
                <TableBody emptyContent="Sin datos en este periodo.">
                  {datos.porDia.map((d) => (
                    <TableRow key={d.dia}>
                      <TableCell>
                        {new Date(d.dia).toLocaleDateString("es-ES")}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {d.copias}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}
