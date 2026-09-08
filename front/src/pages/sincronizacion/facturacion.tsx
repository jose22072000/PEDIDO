import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Pagination,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NavigationHeading } from "@/components/navigation-heading";
import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";

/**
 * El sincronizador de FACTURACIÓN: qué se cotejó contra Ventra y qué no cuadró.
 *
 * # Para qué sirve
 *
 * «Completado» y «facturado» no son lo mismo, y en la lista de pedidos se veían igual. El
 * 07/09/2026, de los 148 pedidos del día anterior sólo 10 tenían factura en Ventra. Los
 * otros 138 podían estar en tres situaciones que desde fuera no se distinguen: aún no se ha
 * facturado, se facturó **sin pegar el folio** en la nota —el folio lo copia y lo pega una
 * persona, y ahí es donde se pierde—, o se pegó mal.
 *
 * # UN DÍA CADA VEZ
 *
 * La primera versión enseñaba siete días de golpe y todos sus pedidos sin factura en una
 * tabla sin fin. Era ilegible: cientos de filas de días distintos mezcladas, y lo de hoy
 * —lo que está pasando ahora mismo— perdido entre lo de la semana pasada.
 *
 * Ahora se mira un día, y al abrir es el de hoy. Los otros siguen ahí: se cambia la fecha.
 * La lista va paginada y con buscador, porque un día bueno son cuatrocientos pedidos.
 *
 * # Lo que NO hace
 *
 * No le pregunta nada a Ventra. Sale de nuestra base y del parte que el worker deja en
 * Redis cada diez minutos. Abrirla no dispara trabajo.
 */

type EstadoFactura =
  | "facturado"
  | "cambiado"
  | "buscando"
  | "no_aparecio"
  | "sin_completar"
  | "sin_cotejar";

interface Conteo {
  total: number;
  facturado: number;
  cambiado: number;
  buscando: number;
  no_aparecio: number;
  sin_completar: number;
  sin_cotejar: number;
}

interface Resumen {
  dia: string;
  hoy: string;
  totales: Conteo;
  sucursales: Array<Conteo & { sucursalId: string | null; sucursal: string }>;
  ultimaPasada: {
    cuando: string;
    segundos: number;
    sucursales: Array<{ sucursal: string; error?: string }>;
  } | null;
}

interface PedidoFila {
  id: string;
  folio: string;
  fecha: string;
  sucursal: string;
  vendedor: string | null;
  cliente: string | null;
  facturaNumero: string | null;
  factura: EstadoFactura;
}

interface Listado {
  total: number;
  pagina: number;
  paginas: number;
  pedidos: PedidoFila[];
}

/** Cómo se pinta cada estado. `cambiado` va en verde: también está facturado. */
const PINTA: Record<
  EstadoFactura,
  { texto: string; color: "success" | "warning" | "default" }
> = {
  facturado: { texto: "Facturado", color: "success" },
  cambiado: { texto: "Facturado · cambió", color: "success" },
  buscando: { texto: "Buscando", color: "default" },
  no_aparecio: { texto: "No apareció", color: "warning" },
  // Sin completar no es una falta: es que todavía no toca. Va en gris.
  sin_completar: { texto: "Sin completar", color: "default" },
  sin_cotejar: { texto: "Sin comprobar", color: "default" },
};

const sumaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);

  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
};

/** «hace 4 minutos», que es lo único que importa de la última comprobación. */
const haceCuanto = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (m < 1) return "hace un momento";
  if (m === 1) return "hace 1 minuto";
  if (m < 60) return `hace ${m} minutos`;

  const h = Math.round(m / 60);

  return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
};

export default function SincronizacionFacturacionPage() {
  const { user } = useAuthStore();
  const esSuperAdmin = esRolGlobal(user?.role);

  // Al abrir, HOY. Es lo que se viene a mirar el 99 % de las veces.
  const [dia, setDia] = useState(() => new Date().toISOString().slice(0, 10));
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [listado, setListado] = useState<Listado | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [cargandoLista, setCargandoLista] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [estados, setEstados] = useState<string[]>([]);
  const [sucursal, setSucursal] = useState("");
  const [pagina, setPagina] = useState(1);

  /** El texto se manda con retraso: no una consulta por tecla. */
  const [busquedaAplicada, setBusquedaAplicada] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim());
      setPagina(1);
    }, 400);

    return () => clearTimeout(t);
  }, [busqueda]);

  const cargarResumen = useCallback(async () => {
    setCargandoResumen(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/facturacion/resumen?dia=${dia}`);

      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
      setResumen((await r.json()) as Resumen);
    } catch (e) {
      addToast({ title: "No se pudo cargar el resumen", description: (e as Error).message, color: "danger" });
    } finally {
      setCargandoResumen(false);
    }
  }, [dia]);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    try {
      const p = new URLSearchParams({ dia, pagina: String(pagina), porPagina: "25" });

      if (busquedaAplicada) p.set("q", busquedaAplicada);
      if (estados.length) p.set("estado", estados.join(","));
      if (sucursal) p.set("sucursalId", sucursal);

      const r = await fetch(`${getApiBaseUrl()}/facturacion/pedidos?${p}`);

      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
      setListado((await r.json()) as Listado);
    } catch (e) {
      addToast({ title: "No se pudo cargar la lista", description: (e as Error).message, color: "danger" });
    } finally {
      setCargandoLista(false);
    }
  }, [dia, pagina, busquedaAplicada, estados, sucursal]);

  useEffect(() => {
    void cargarResumen();
  }, [cargarResumen]);
  useEffect(() => {
    void cargarLista();
  }, [cargarLista]);

  const copiar = async (folio: string) => {
    try {
      await navigator.clipboard.writeText(folio);
      addToast({ title: `Folio ${folio} copiado`, color: "success" });
    } catch {
      addToast({ title: "No se pudo copiar", color: "warning" });
    }
  };

  const conError = useMemo(
    () => (resumen?.ultimaPasada?.sucursales ?? []).filter((s) => s.error),
    [resumen],
  );

  const t = resumen?.totales;
  const esHoy = resumen ? resumen.dia === resumen.hoy : false;

  /** Cambiar de día o de filtro es pedir otra lista: volver a la página 1. */
  const irAlDia = (nuevo: string) => {
    setDia(nuevo);
    setPagina(1);
  };

  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        /**
         * A Configuración si se puede entrar, y si no al panel.
         *
         * De aquí se entra por el bloque de sincronizadores de Configuración, así que
         * devolver al panel obliga a volver a bajar hasta él. Pero esta pantalla también
         * la abren el Supervisor y el Gestor, y Configuración es sólo del Super Admin.
         */
        cta={
          esSuperAdmin
            ? { href: "/panel/configuracion", label: "Volver a Configuración" }
            : { href: "/panel", label: "Volver al panel" }
        }
        icon="reports"
        paragraph="Qué pedidos tienen factura en Ventra y cuáles no. Un pedido sin factura con el día ya cerrado no va a entrar en ninguna ruta."
        title="Sincronización · Facturación"
      />

      {/* EL DÍA, y la última comprobación, en la misma línea.

          Los dos contestan a «¿esto está al día?», que es lo primero que se pregunta al
          abrir. Si el cotejo está parado, lo de abajo es una foto vieja y hay que saberlo
          antes de leerla. */}
      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <Input
            className="lg:max-w-56"
            label="Día"
            size="lg"
            type="date"
            value={dia}
            variant="bordered"
            onChange={(e) => irAlDia(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={esHoy ? "solid" : "flat"}
              onPress={() => irAlDia(resumen?.hoy ?? new Date().toISOString().slice(0, 10))}
            >
              Hoy
            </Button>
            <Button size="sm" variant="flat" onPress={() => irAlDia(sumaDias(dia, -1))}>
              Día anterior
            </Button>
            <Button
              isDisabled={esHoy}
              size="sm"
              variant="flat"
              onPress={() => irAlDia(sumaDias(dia, 1))}
            >
              Día siguiente
            </Button>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3 text-sm">
            {!resumen?.ultimaPasada ? (
              <span className="text-warning-600">
                <strong>Sin dato de la última comprobación.</strong> El cotejo no ha
                escrito en dos horas: o el worker está parado, o no hay Redis.
              </span>
            ) : (
              <>
                <span className="text-default-500">
                  Comprobado {haceCuanto(resumen.ultimaPasada.cuando)} · tardó{" "}
                  {resumen.ultimaPasada.segundos} s
                </span>
                {conError.length === 0 ? (
                  <Chip color="success" size="sm" variant="flat">
                    Las {resumen.ultimaPasada.sucursales.length} sucursales respondieron
                  </Chip>
                ) : (
                  <Chip color="danger" size="sm" variant="flat">
                    {conError.length} con error
                  </Chip>
                )}
              </>
            )}
            <Button
              isLoading={cargandoResumen || cargandoLista}
              size="sm"
              variant="flat"
              onPress={() => {
                void cargarResumen();
                void cargarLista();
              }}
            >
              Actualizar
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* El porqué del fallo, con nombre y apellidos. Sólo cuando lo hay: una tarjeta que
          dice «ningún error» todos los días acaba sin leerse. */}
      {conError.length > 0 && (
        <Card className="mb-6 border-medium border-danger-200">
          <CardBody className="gap-1 text-sm">
            {conError.map((s) => (
              <div key={s.sucursal} className="text-danger-600">
                <strong>{s.sucursal}</strong>: {s.error}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {cargandoResumen && !resumen ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Cinco y no cuatro: «sin completar» explica el hueco entre los pedidos del día
              y la suma de los demás. Sin ese recuadro, los números no cuadran a la vista y
              parece que faltan pedidos. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {[
              { t: "Pedidos del día", v: t?.total ?? 0, c: "text-default-700" },
              {
                t: "Con factura",
                v: (t?.facturado ?? 0) + (t?.cambiado ?? 0),
                c: "text-success-600",
              },
              { t: "Buscando", v: t?.buscando ?? 0, c: "text-default-500" },
              { t: "No apareció", v: t?.no_aparecio ?? 0, c: "text-warning-600" },
              { t: "Sin completar", v: t?.sin_completar ?? 0, c: "text-default-400" },
            ].map((x) => (
              <Card key={x.t}>
                <CardBody className="py-4">
                  <div className="text-xs uppercase tracking-wide text-default-500">{x.t}</div>
                  <div className={`text-3xl font-semibold tabular-nums ${x.c}`}>{x.v}</div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Por sucursal: una fila por sucursal y sólo del día que se está mirando. Son
              diez filas como mucho, así que no necesita paginación ni la va a necesitar. */}
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Por sucursal</h2>
            </CardHeader>
            <CardBody className="pt-0 overflow-x-auto">
              <Table removeWrapper aria-label="Facturación por sucursal">
                <TableHeader>
                  <TableColumn>Sucursal</TableColumn>
                  <TableColumn align="end">Pedidos</TableColumn>
                  <TableColumn align="end">Con factura</TableColumn>
                  <TableColumn align="end">Buscando</TableColumn>
                  <TableColumn align="end">No apareció</TableColumn>
                </TableHeader>
                <TableBody emptyContent="Ese día no hay pedidos.">
                  {(resumen?.sucursales ?? []).map((s) => (
                    <TableRow key={s.sucursalId ?? s.sucursal}>
                      <TableCell className="font-medium">{s.sucursal}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-success-600">
                        {s.facturado + s.cambiado || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-default-500">
                        {s.buscando || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${
                          s.no_aparecio ? "text-warning-600" : "text-default-400"
                        }`}
                      >
                        {s.no_aparecio || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex-col items-start gap-4">
              <div>
                <h2 className="text-lg font-semibold">Pedidos del día</h2>
                <p className="text-sm text-default-500">
                  Copia el folio y búscalo en la nota de la factura en Ventra: si está, se
                  escribió mal; si no está, no se facturó.
                </p>
              </div>

              {/* Buscador y filtros. Sin ellos, un día bueno son cuatrocientas filas y
                  encontrar un folio concreto es imposible. */}
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  isClearable
                  label="Buscar"
                  placeholder="Folio, factura, cliente o vendedor"
                  size="sm"
                  value={busqueda}
                  variant="bordered"
                  onChange={(e) => setBusqueda(e.target.value)}
                  onClear={() => setBusqueda("")}
                />
                <Select
                  label="Estado"
                  selectedKeys={new Set(estados)}
                  selectionMode="multiple"
                  size="sm"
                  variant="bordered"
                  onSelectionChange={(k) => {
                    setEstados([...(k as Set<string>)].map(String));
                    setPagina(1);
                  }}
                >
                  {(Object.keys(PINTA) as EstadoFactura[]).map((e) => (
                    <SelectItem key={e}>{PINTA[e].texto}</SelectItem>
                  ))}
                </Select>
                <Select
                  label="Sucursal"
                  selectedKeys={sucursal ? [sucursal] : []}
                  size="sm"
                  variant="bordered"
                  onChange={(e) => {
                    setSucursal(e.target.value);
                    setPagina(1);
                  }}
                >
                  {(resumen?.sucursales ?? [])
                    .filter((s) => s.sucursalId)
                    .map((s) => (
                      <SelectItem key={s.sucursalId!}>{s.sucursal}</SelectItem>
                    ))}
                </Select>
              </div>
            </CardHeader>
            <CardBody className="pt-0 overflow-x-auto">
              <Table removeWrapper aria-label="Pedidos del día">
                <TableHeader>
                  <TableColumn>Folio</TableColumn>
                  <TableColumn>Estado</TableColumn>
                  <TableColumn>Factura</TableColumn>
                  <TableColumn>Sucursal</TableColumn>
                  <TableColumn>Vendedor</TableColumn>
                  <TableColumn>Cliente</TableColumn>
                  <TableColumn> </TableColumn>
                </TableHeader>
                <TableBody
                  emptyContent={
                    cargandoLista ? "Cargando…" : "Ningún pedido con esos filtros."
                  }
                >
                  {(listado?.pedidos ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.folio}</TableCell>
                      <TableCell>
                        <Chip color={PINTA[p.factura].color} size="sm" variant="flat">
                          {PINTA[p.factura].texto}
                        </Chip>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {p.facturaNumero ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{p.sucursal}</TableCell>
                      <TableCell className="text-sm">{p.vendedor ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.cliente ?? "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="flat" onPress={() => void copiar(p.folio)}>
                          Copiar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {listado && listado.paginas > 1 && (
                <div className="flex items-center justify-between gap-4 pt-4">
                  <span className="text-sm text-default-500">
                    {listado.total} pedidos
                  </span>
                  <Pagination
                    showControls
                    page={listado.pagina}
                    total={listado.paginas}
                    onChange={setPagina}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}
