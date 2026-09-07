import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { NavigationHeading } from "@/components/navigation-heading";
import { getApiBaseUrl } from "@/config";

/**
 * El sincronizador de FACTURACIÓN: qué se cotejó contra Ventra y qué no cuadró.
 *
 * # Para qué sirve esta pantalla
 *
 * «Completado» y «facturado» no son lo mismo, y en la lista de pedidos se veían igual. El
 * 07/09/2026, de los 148 pedidos del día anterior sólo 10 tenían factura en Ventra. Los
 * otros 138 podían estar en tres situaciones que desde fuera no se distinguen:
 *
 *   1. Aún no se ha facturado —el 6 fue domingo; se factura al día siguiente—.
 *   2. Se facturó y **no se pegó el folio** en la nota. El folio lo copia y lo pega una
 *      persona al facturar en Ventra: aquí es donde se pierde de verdad.
 *   3. Se pegó mal.
 *
 * La primera es normal y no hay que hacer nada. Las otras dos dejan al pedido fuera de
 * toda ruta sin que nadie se entere. Por eso la pantalla las separa con el corte de las
 * 18:30: los de hoy salen como **buscando**, y sólo los de días ya cerrados como **no
 * apareció**, que son los que hay que perseguir.
 *
 * # Lo que NO hace
 *
 * No le pregunta nada a Ventra. Todo sale de nuestra base y del parte que el worker deja
 * en Redis cada diez minutos. Abrirla no dispara trabajo: si sondeara, abrirla ocho veces
 * serían ochenta consultas por la VPN.
 */

interface FilaDia {
  sucursalId: string | null;
  sucursal: string;
  dia: string;
  total: number;
  facturado: number;
  cambiado: number;
  buscando: number;
  noAparecio: number;
  sinCotejar: number;
}

interface Perseguir {
  id: string;
  folio: string;
  fecha: string;
  sucursal: string;
  vendedor: string | null;
  cliente: string | null;
  estado: string | null;
}

interface PasadaSucursal {
  sucursal: string;
  database: string;
  cotejados: number;
  igual: number;
  cambiado: number;
  sinFactura: number;
  error?: string;
}

interface Resumen {
  desde: string;
  hasta: string;
  horaCorte: number;
  dias: FilaDia[];
  aPerseguir: Perseguir[];
  aPerseguirTotal: number;
  ultimaPasada: {
    cuando: string;
    segundos: number;
    sucursales: PasadaSucursal[];
  } | null;
}

/** AAAA-MM-DD de hace `n` días, que es lo que espera el input de tipo fecha. */
const haceDias = (n: number) => {
  const d = new Date();

  d.setDate(d.getDate() - n);

  return d.toISOString().slice(0, 10);
};

const hoy = () => new Date().toISOString().slice(0, 10);

/** «hace 4 minutos», que es lo único que importa de la última pasada. */
const haceCuanto = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (m < 1) return "hace un momento";
  if (m === 1) return "hace 1 minuto";
  if (m < 60) return `hace ${m} minutos`;

  const h = Math.round(m / 60);

  return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
};

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

export default function SincronizacionFacturacionPage() {
  const [desde, setDesde] = useState(haceDias(7));
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(
        `${getApiBaseUrl()}/facturacion/resumen?desde=${desde}&hasta=${hasta}`,
      );

      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));

        throw new Error(cuerpo.error || `Error ${r.status}`);
      }
      setDatos((await r.json()) as Resumen);
    } catch (e) {
      addToast({
        title: "No se pudo cargar",
        description: (e as Error).message,
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const copiar = async (folio: string) => {
    try {
      await navigator.clipboard.writeText(folio);
      addToast({ title: `Folio ${folio} copiado`, color: "success" });
    } catch {
      addToast({ title: "No se pudo copiar", color: "warning" });
    }
  };

  const totales = (datos?.dias ?? []).reduce(
    (a, d) => ({
      total: a.total + d.total,
      facturado: a.facturado + d.facturado + d.cambiado,
      buscando: a.buscando + d.buscando,
      noAparecio: a.noAparecio + d.noAparecio,
    }),
    { total: 0, facturado: 0, buscando: 0, noAparecio: 0 },
  );

  const conError = (datos?.ultimaPasada?.sucursales ?? []).filter((s) => s.error);

  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        cta={{ href: "/panel", label: "Volver al panel" }}
        icon="reports"
        paragraph="Qué pedidos tienen factura en Ventra y cuáles no. Un pedido sin factura pasadas las 6:30 de la tarde no va a entrar en ninguna ruta."
        title="Sincronización · Facturación"
      />

      {/* La última pasada del worker. Va arriba porque si el cotejo está parado, todo lo
          de abajo es una foto vieja y hay que saberlo ANTES de leerla. */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Última comprobación</h2>
          <Button
            isLoading={cargando}
            size="sm"
            variant="flat"
            onPress={() => void cargar()}
          >
            Actualizar
          </Button>
        </CardHeader>
        <CardBody className="pt-0">
          {!datos?.ultimaPasada ? (
            <div className="text-sm text-warning-600">
              <strong>Sin dato.</strong> El cotejo no ha dejado parte en las últimas dos
              horas: o el worker está parado, o no hay Redis. Lo de abajo puede estar
              atrasado.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Chip color="default" size="sm" variant="flat">
                {haceCuanto(datos.ultimaPasada.cuando)}
              </Chip>
              <span className="text-default-500">
                tardó {datos.ultimaPasada.segundos} s ·{" "}
                {datos.ultimaPasada.sucursales.length} sucursales
              </span>
              {conError.length === 0 ? (
                <Chip color="success" size="sm" variant="flat">
                  Todas respondieron
                </Chip>
              ) : (
                <Chip color="danger" size="sm" variant="flat">
                  {conError.length} con error
                </Chip>
              )}
            </div>
          )}

          {/* El porqué del fallo, con nombre y apellidos. Hasta ahora sólo salía en el
              registro del worker, que no mira nadie. */}
          {conError.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {conError.map((s) => (
                <li key={s.sucursal} className="text-danger-600">
                  <strong>{s.sucursal}</strong>: {s.error}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardBody className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
          <Input
            label="Desde"
            labelPlacement="inside"
            type="date"
            value={desde}
            onValueChange={setDesde}
          />
          <Input
            label="Hasta"
            labelPlacement="inside"
            type="date"
            value={hasta}
            onValueChange={setHasta}
          />
        </CardBody>
      </Card>

      {cargando && !datos ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { t: "Pedidos", v: totales.total, c: "text-default-700" },
              { t: "Con factura", v: totales.facturado, c: "text-success-600" },
              { t: "Buscando", v: totales.buscando, c: "text-default-500" },
              { t: "No apareció", v: totales.noAparecio, c: "text-warning-600" },
            ].map((x) => (
              <Card key={x.t}>
                <CardBody className="py-4">
                  <div className="text-xs uppercase tracking-wide text-default-500">
                    {x.t}
                  </div>
                  <div className={`text-3xl font-semibold tabular-nums ${x.c}`}>
                    {x.v}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Por sucursal y día</h2>
            </CardHeader>
            <CardBody className="pt-0 overflow-x-auto">
              <Table removeWrapper aria-label="Facturación por sucursal y día">
                <TableHeader>
                  <TableColumn>Día</TableColumn>
                  <TableColumn>Sucursal</TableColumn>
                  <TableColumn align="end">Pedidos</TableColumn>
                  <TableColumn align="end">Facturados</TableColumn>
                  <TableColumn align="end">Cambiados</TableColumn>
                  <TableColumn align="end">Buscando</TableColumn>
                  <TableColumn align="end">No apareció</TableColumn>
                </TableHeader>
                <TableBody emptyContent="No hay pedidos en ese rango.">
                  {(datos?.dias ?? []).map((d) => (
                    <TableRow key={`${d.sucursalId}-${d.dia}`}>
                      <TableCell className="tabular-nums">{fechaCorta(d.dia)}</TableCell>
                      <TableCell className="font-medium">{d.sucursal}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-success-600">
                        {d.facturado || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-success-600">
                        {d.cambiado || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-default-500">
                        {d.buscando || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${
                          d.noAparecio ? "text-warning-600" : "text-default-400"
                        }`}
                      >
                        {d.noAparecio || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex-col items-start gap-1">
              <h2 className="text-lg font-semibold">
                Sin factura, con el día ya cerrado
              </h2>
              <p className="text-sm text-default-500">
                Éstos son los que hay que buscar en Ventra. Copia el folio y búscalo en la
                nota de la factura: si está, es que se escribió mal; si no, no se facturó.
                {datos && datos.aPerseguirTotal > datos.aPerseguir.length && (
                  <>
                    {" "}
                    Se enseñan {datos.aPerseguir.length} de {datos.aPerseguirTotal}.
                  </>
                )}
              </p>
            </CardHeader>
            <CardBody className="pt-0 overflow-x-auto">
              <Table removeWrapper aria-label="Pedidos sin factura">
                <TableHeader>
                  <TableColumn>Folio</TableColumn>
                  <TableColumn>Día</TableColumn>
                  <TableColumn>Sucursal</TableColumn>
                  <TableColumn>Vendedor</TableColumn>
                  <TableColumn>Cliente</TableColumn>
                  <TableColumn> </TableColumn>
                </TableHeader>
                <TableBody emptyContent="Ninguno. Todo lo cerrado tiene su factura.">
                  {(datos?.aPerseguir ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.folio}</TableCell>
                      <TableCell className="tabular-nums">{fechaCorta(p.fecha)}</TableCell>
                      <TableCell>{p.sucursal}</TableCell>
                      <TableCell className="text-sm">{p.vendedor ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.cliente ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => void copiar(p.folio)}
                        >
                          Copiar folio
                        </Button>
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
