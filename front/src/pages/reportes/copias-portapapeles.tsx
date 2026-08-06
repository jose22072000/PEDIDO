import { useCallback, useEffect, useMemo, useState } from "react";
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
import { esFechaEnviable } from "@/lib/fecha-enviable";
import Icons from "@/components/icons/iconify";
import { exportToExcel } from "@/utils/excelExport";

/**
 * Cuántas veces se ha usado el botón de copiar al portapapeles, y QUIÉN y CUÁNDO.
 *
 * Sirve para medir el único paso MANUAL del circuito: la operadora copia
 * `P-folio; V-vendedor; C-cliente;` y lo pega en la observación de la factura de
 * AxisPos. Un pedido solo se puede dar por facturado si su folio aparece en esa
 * observación, así que quien no pega el código deja sus pedidos como "no
 * convertidos" aunque los haya facturado todos.
 *
 * De ahí que el número que manda sea el de tipo **pedido**: los de vendedor y
 * cliente se copian para otras cosas y se cuentan aparte para no inflarlo.
 *
 * Y de ahí también el cruce **persona × día**: esto no lo usa una persona, lo
 * usan varias operadoras, cada una en su sucursal. Un total suelto no distingue
 * "lo usan todas" de "lo usa una sola", ni enseña a quien lo dejó de usar el
 * martes. El total dice cuánto; el cruce dice quién y desde cuándo.
 */

interface Resumen {
  zona: string;
  total: number;
  pedidos: number;
  porTipo: Record<string, number>;
  porUsuario: Array<{
    username: string;
    copias: number;
    pedidos: number;
    dias: number;
    ultima: string | null;
  }>;
  porSucursal: Array<{
    sucursalId: string | null;
    nombre: string;
    copias: number;
  }>;
  porDia: Array<{ dia: string; copias: number; pedidos: number }>;
  porUsuarioDia: Array<{ dia: string; username: string; copias: number }>;
  porHora: Array<{ hora: number; copias: number }>;
}

/**
 * Formatea SIN convertir de zona horaria.
 *
 * El servidor ya devuelve los días y las horas en hora de Cuba. Si aquí se
 * hiciera `new Date(...).toLocaleDateString()`, el navegador los tomaría por
 * UTC y les volvería a restar las cuatro horas: todo lo de la mañana temprano
 * se pintaría como el día anterior. Se corta la cadena y ya.
 */
const dia = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");

  return `${d}/${m}/${a}`;
};

const fechaYHora = (iso: string | null) =>
  iso ? `${dia(iso)} ${iso.slice(11, 16)}` : "—";

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
    if (!esFechaEnviable(desde) || !esFechaEnviable(hasta)) {
      setError("Revisa las fechas: tienen que ser AAAA-MM-DD.");

      return;
    }
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

  // La rejilla persona × día. Se arma aquí y no en el servidor porque es solo
  // darle la vuelta a lo que ya vino: una fila por día, una columna por persona.
  const rejilla = useMemo(() => {
    if (!datos) return { dias: [], usuarios: [], celda: new Map<string, number>() };

    const celda = new Map<string, number>();
    const dias: string[] = [];
    const usuarios = new Set<string>();

    for (const x of datos.porUsuarioDia) {
      const d = x.dia.slice(0, 10);

      if (!dias.includes(d)) dias.push(d);
      usuarios.add(x.username);
      celda.set(`${d}|${x.username}`, x.copias);
    }

    // Las personas se ordenan por total, para que las que más lo usan queden a
    // la izquierda y no haya que buscarlas.
    const porTotal = new Map(datos.porUsuario.map((u) => [u.username, u.copias]));

    return {
      dias,
      usuarios: [...usuarios].sort(
        (a, b) => (porTotal.get(b) ?? 0) - (porTotal.get(a) ?? 0),
      ),
      celda,
    };
  }, [datos]);

  const maxHora = useMemo(
    () => Math.max(1, ...(datos?.porHora ?? []).map((h) => h.copias)),
    [datos],
  );

  const exportar = () => {
    if (!datos) return;
    exportToExcel(
      datos.porUsuario.map((u) => ({
        Usuario: mostrarUsuario(u.username),
        "Códigos de pedido": u.pedidos,
        "Copias totales": u.copias,
        "Días que lo usó": u.dias,
        "Última vez": fechaYHora(u.ultima),
      })),
      `uso-portapapeles-${desde}-a-${hasta}`,
    );
  };

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/reportes", label: "Volver a Reportes" }}
        icon="reports"
        paragraph="Quién copió el código para pegarlo en la factura, cuándo y cuántas veces"
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                <p className="text-3xl font-bold">{datos.porUsuario.length}</p>
                <p className="text-sm text-default-500">Personas que lo usan</p>
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

          <Card>
            <CardHeader className="flex flex-col items-start gap-1">
              <h3 className="font-bold">Quién lo usa</h3>
              <p className="text-xs text-default-500">
                &quot;Días que lo usó&quot; separa a quien lo usa a diario de
                quien lo probó una tarde: en el total suelto se ven igual.
              </p>
            </CardHeader>
            <CardBody>
              <Table removeWrapper aria-label="Uso por persona">
                <TableHeader>
                  <TableColumn>USUARIO</TableColumn>
                  <TableColumn align="end">CÓDIGOS DE PEDIDO</TableColumn>
                  <TableColumn align="end">COPIAS TOTALES</TableColumn>
                  <TableColumn align="end">DÍAS QUE LO USÓ</TableColumn>
                  <TableColumn>ÚLTIMA VEZ</TableColumn>
                </TableHeader>
                <TableBody emptyContent="Todavía no se ha copiado nada en este periodo.">
                  {datos.porUsuario.map((u) => (
                    <TableRow key={u.username}>
                      <TableCell>{mostrarUsuario(u.username)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {u.pedidos}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {u.copias}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {u.dias}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fechaYHora(u.ultima)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          {/* El cruce. Es lo que contesta "cuándo lo hace cada una". */}
          <Card>
            <CardHeader className="flex flex-col items-start gap-1">
              <h3 className="font-bold">Cada persona, día a día</h3>
              <p className="text-xs text-default-500">
                Un hueco vacío es un día en el que esa persona no copió nada.
              </p>
            </CardHeader>
            <CardBody>
              {/* La tabla se desplaza SOLA: con muchas operadoras se pone ancha,
                  y sin esto sería la página entera la que se movería de lado. */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-default-200">
                      <th className="text-left py-2 pr-4 font-semibold sticky left-0 bg-content1">
                        DÍA
                      </th>
                      {rejilla.usuarios.map((u) => (
                        <th
                          key={u}
                          className="text-right py-2 px-3 font-semibold whitespace-nowrap"
                        >
                          {mostrarUsuario(u)}
                        </th>
                      ))}
                      <th className="text-right py-2 pl-3 font-semibold">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejilla.dias.map((d) => {
                      const fila = rejilla.usuarios.map(
                        (u) => rejilla.celda.get(`${d}|${u}`) ?? 0,
                      );

                      return (
                        <tr key={d} className="border-b border-default-100">
                          <td className="py-2 pr-4 whitespace-nowrap sticky left-0 bg-content1">
                            {dia(d)}
                          </td>
                          {fila.map((n, i) => (
                            <td
                              key={rejilla.usuarios[i]}
                              className={`text-right py-2 px-3 font-mono ${
                                n === 0 ? "text-default-300" : ""
                              }`}
                            >
                              {n === 0 ? "·" : n}
                            </td>
                          ))}
                          <td className="text-right py-2 pl-3 font-mono font-semibold">
                            {fila.reduce((a, b) => a + b, 0)}
                          </td>
                        </tr>
                      );
                    })}
                    {!rejilla.dias.length && (
                      <tr>
                        <td className="py-4 text-default-500" colSpan={2}>
                          Sin datos en este periodo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-col items-start gap-1">
                <h3 className="font-bold">A qué hora se factura</h3>
                <p className="text-xs text-default-500">
                  Hora de Cuba ({datos.zona}).
                </p>
              </CardHeader>
              <CardBody className="gap-1">
                {datos.porHora.map((h) => (
                  <div key={h.hora} className="flex items-center gap-2 text-sm">
                    <span className="w-12 font-mono text-default-500">
                      {String(h.hora).padStart(2, "0")}:00
                    </span>
                    <div className="flex-1 bg-default-100 rounded h-4 overflow-hidden">
                      <div
                        className="bg-primary h-full"
                        style={{ width: `${(h.copias / maxHora) * 100}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono">{h.copias}</span>
                  </div>
                ))}
                {!datos.porHora.length && (
                  <p className="text-default-500 text-sm">
                    Sin datos en este periodo.
                  </p>
                )}
              </CardBody>
            </Card>

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
          </div>

          <Card>
            <CardHeader>
              <h3 className="font-bold">Por día</h3>
            </CardHeader>
            <CardBody>
              <Table removeWrapper aria-label="Copias por día">
                <TableHeader>
                  <TableColumn>DÍA</TableColumn>
                  <TableColumn align="end">CÓDIGOS DE PEDIDO</TableColumn>
                  <TableColumn align="end">COPIAS TOTALES</TableColumn>
                </TableHeader>
                <TableBody emptyContent="Sin datos en este periodo.">
                  {datos.porDia.map((d) => (
                    <TableRow key={d.dia}>
                      <TableCell>{dia(d.dia)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {d.pedidos}
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
