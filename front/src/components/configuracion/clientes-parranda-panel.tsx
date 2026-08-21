import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Select,
  SelectItem,
  Switch,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
  Spinner,
  addToast,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cards } from "../primitives";

import { getApiBaseUrl } from "@/config";

/**
 * Panel de Clientes (Parranda) — solo Super Admin.
 * - Resumen POR SUCURSAL (total / con geo) + total global.
 * - Historial GLOBAL de sincronizaciones del worker (fecha + resultado) para ver que
 *   corre solo (cron 6pm) y no sobrecarga Parranda.
 * - Tabla de clientes PAGINADA con filtros (sucursal, municipio, tipo, búsqueda, solo-geo)
 *   y la fecha en que entró cada uno.
 * - Botón "Sincronizar ahora" (además del cron automático).
 */

interface SucursalResumen {
  id: string;
  codigo: string | null;
  nombre: string;
  total: number;
  conGeo: number;
  sinGeo: number;
}
interface SyncRun {
  jobId: string;
  estado: string;
  resultado?: {
    total: number;
    creados: number;
    actualizados: number;
    /** Encontrados en Parranda pero sin nada que cambiar. */
    sinCambios?: number;
    conGeo: number;
    sinGeo: number;
    errores: number;
    paginas: number;
    /** Los primeros motivos distintos de error. */
    erroresDetalle?: string[];
    /** Qué cambió, cliente a cliente (muestra acotada). */
    cambios?: Array<{
      cliente: string;
      sucursal: string | null;
      campos: Array<{ campo: string; antes: string | null; despues: string | null }>;
    }>;
  };
  error?: string;
  cuando?: number | null;
}
interface Resumen {
  porSucursal: SucursalResumen[];
  granTotal: number;
  granConGeo: number;
  syncs: SyncRun[];
  /** Cuándo toca la próxima automática (milisegundos). null = no hay ninguna. */
  proximaSync?: number | null;
}
interface ClienteRow {
  id: string;
  nombre: string;
  codigo: string | null;
  municipio: string | null;
  tipoCliente: string | null;
  latitud: number | null;
  longitud: number | null;
  createdAt: string;
  updatedAt: string;
  sucursal: { nombre: string; codigo: string | null } | null;
}

const api = getApiBaseUrl;
const fmtFecha = (v: number | string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
};

export const ClientesParrandaPanel = () => {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  // Filtros + paginación de la tabla.
  // La sincronización que se está mirando en el detalle.
  const [syncVisto, setSyncVisto] = useState<SyncRun | null>(null);
  const {
    isOpen: detalleAbierto,
    onOpen: onDetalleOpen,
    onClose: onDetalleClose,
  } = useDisclosure();
  const [sucursalId, setSucursalId] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [tipo, setTipo] = useState("");
  const [search, setSearch] = useState("");
  const [soloGeo, setSoloGeo] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [lista, setLista] = useState<{ data: ClienteRow[]; total: number; pages: number } | null>(null);
  const [cargandoLista, setCargandoLista] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargarResumen = useCallback(async () => {
    try {
      const r = await fetch(`${api()}/clientes/resumen-parranda`).then((x) => x.json());
      if (!r.error) setResumen(r);
    } catch {
      /* reintenta al recargar */
    }
  }, []);

  const cargarMunicipios = useCallback(async () => {
    try {
      const url = `${api()}/clientes/municipios${sucursalId ? `?sucursalId=${sucursalId}` : ""}`;
      const r = await fetch(url).then((x) => x.json());
      setMunicipios(r.municipios ?? []);
    } catch {
      setMunicipios([]);
    }
  }, [sucursalId]);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (sucursalId) p.set("sucursalId", sucursalId);
      if (municipio) p.set("municipio", municipio);
      if (tipo) p.set("tipo", tipo);
      if (search) p.set("search", search);
      if (soloGeo) p.set("soloGeo", "1");
      const r = await fetch(`${api()}/clientes/parranda-lista?${p.toString()}`).then((x) => x.json());
      if (!r.error) setLista(r);
    } catch {
      /* ignore */
    } finally {
      setCargandoLista(false);
    }
  }, [page, limit, sucursalId, municipio, tipo, search, soloGeo]);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);
  useEffect(() => {
    cargarMunicipios();
  }, [cargarMunicipios]);
  // Debounce de la búsqueda/filtros para no pegarle a la API en cada tecla.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => cargarLista(), 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [cargarLista]);
  // Al cambiar un filtro, volver a la página 1.
  useEffect(() => {
    setPage(1);
  }, [sucursalId, municipio, tipo, search, soloGeo]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const res = await fetch(`${api()}/clientes/sync-parranda`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo iniciar");
      addToast({ title: "Sincronización iniciada", description: "El worker está trayendo los clientes de Parranda…", color: "primary" });
      // Poll del estado hasta que termine.
      const jobId = j.jobId;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const s = await fetch(`${api()}/clientes/sync-parranda/status/${jobId}`).then((x) => x.json());
        if (s.estado === "completado") {
          const r = s.resultado || {};
          addToast({ title: "Sincronización completa", description: `${r.actualizados ?? 0} cambiaron · ${r.sinCambios ?? 0} ya estaban al día · ${r.conGeo ?? 0} con geo`, color: "success" });
          break;
        }
        if (s.estado === "error") {
          addToast({ title: "Falló la sincronización", description: String(s.error || "").slice(0, 120), color: "danger" });
          break;
        }
      }
      await Promise.all([cargarResumen(), cargarLista()]);
    } catch (e) {
      addToast({ title: "Error", description: e instanceof Error ? e.message : "No se pudo sincronizar", color: "danger" });
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <>
    <Card className={cards()}>
      <CardBody>
        <div className="flex flex-col gap-5">
          {/* Encabezado + acción */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-semibold">Clientes · Parranda</h3>
              <p className="text-sm text-default-500">
                {/* Se dice cuándo toca la PRÓXIMA, no solo que "se hace sola".
                    Estuvo meses prometiéndolo sin que nadie la disparara y no se
                    notó, porque no había forma de comprobarlo desde aquí. */}
                {resumen?.proximaSync
                  ? `Se sincroniza sola todos los días a las 6:00 pm. La próxima: ${new Date(resumen.proximaSync).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. También podés correrlo a mano.`
                  : "La sincronización automática no está programada ahora mismo. Podés correrla a mano."}
              </p>
            </div>
            <Button color="primary" isLoading={sincronizando} onPress={sincronizar}>
              {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
            </Button>
          </div>

          {/* Resumen global + por sucursal */}
          {resumen && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3 flex-wrap">
                <Chip color="primary" variant="flat" size="lg">
                  {resumen.granTotal.toLocaleString("es")} clientes
                </Chip>
                <Chip color="success" variant="flat" size="lg">
                  {resumen.granConGeo.toLocaleString("es")} con geolocalización
                </Chip>
              </div>
              <div className="flex gap-2 flex-wrap">
                {resumen.porSucursal.map((s) => (
                  <Chip key={s.id} variant="bordered" className="h-auto py-1">
                    <span className="font-semibold">{s.codigo || s.nombre}</span>{" "}
                    <span className="text-default-500">{s.total.toLocaleString("es")}</span>{" "}
                    <span className="text-success">({s.conGeo.toLocaleString("es")} geo)</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Historial de sincronizaciones del worker */}
          {resumen && resumen.syncs.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">Últimas sincronizaciones</p>
              <div className="flex flex-col gap-1 max-h-80 overflow-auto rounded-md border border-default-200 p-2">
                {resumen.syncs.map((s) => (
                  // La fila ENTERA abre el detalle. Un enlace pequeño al final se lo
                  // salta cualquiera —de hecho se lo saltó—; una fila que se pulsa se
                  // encuentra sola.
                  <button
                    key={s.jobId}
                    type="button"
                    className="flex flex-col gap-1 text-xs text-left rounded px-1 py-0.5 hover:bg-default-100"
                    onClick={() => {
                      setSyncVisto(s);
                      onDetalleOpen();
                    }}
                  >
                   <div className="flex items-center gap-2 w-full">
                    <Chip
                      size="sm"
                      color={s.estado === "completado" ? "success" : s.estado === "error" ? "danger" : "warning"}
                      variant="flat"
                    >
                      {s.estado}
                    </Chip>
                    <span className="text-default-500">{fmtFecha(s.cuando)}</span>
                    {s.resultado && (
                      <span>
                        {/* "cambiaron" es lo que de verdad se escribió. Antes
                            decía "act" y contaba TODOS los encontrados, así que
                            marcaba 6127 en cada pasada aunque no hubiera
                            cambiado un solo dato. */}
                        {s.resultado.actualizados} cambiaron
                        {s.resultado.sinCambios != null
                          ? ` · ${s.resultado.sinCambios} ya estaban al día`
                          : ""}
                        {" · "}
                        {s.resultado.conGeo} geo · {s.resultado.errores} err
                      </span>
                    )}
                    {s.error && <span className="text-danger truncate">{s.error}</span>}
                    <span className="ml-auto underline text-primary shrink-0">
                      ver qué cambió
                    </span>
                   </div>

                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex gap-2 flex-wrap items-end">
            <Select
              label="Sucursal"
              size="sm"
              className="w-44"
              selectedKeys={sucursalId ? [sucursalId] : []}
              onChange={(e) => setSucursalId(e.target.value)}
            >
              {[
                <SelectItem key="">Todas</SelectItem>,
                ...(resumen?.porSucursal ?? []).map((s) => (
                  <SelectItem key={s.id}>{s.nombre}</SelectItem>
                )),
              ]}
            </Select>
            <Select
              label="Municipio"
              size="sm"
              className="w-44"
              selectedKeys={municipio ? [municipio] : []}
              onChange={(e) => setMunicipio(e.target.value)}
            >
              {[
                <SelectItem key="">Todos</SelectItem>,
                ...municipios.map((m) => <SelectItem key={m}>{m}</SelectItem>),
              ]}
            </Select>
            <Input label="Tipo" size="sm" className="w-36" value={tipo} onValueChange={setTipo} placeholder="Kiosko…" />
            <Input label="Buscar cliente" size="sm" className="w-56" value={search} onValueChange={setSearch} placeholder="Nombre…" />
            <div className="flex items-center gap-2 pb-1">
              <Switch size="sm" isSelected={soloGeo} onValueChange={setSoloGeo}>
                Solo con geo
              </Switch>
            </div>
          </div>

          {/* Tabla paginada */}
          <Table
            aria-label="Clientes de Parranda"
            bottomContent={
              lista && lista.pages > 1 ? (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-default-500">{lista.total.toLocaleString("es")} clientes</span>
                  <Pagination showControls size="sm" page={page} total={lista.pages} onChange={setPage} />
                </div>
              ) : (
                <span className="text-xs text-default-500">{lista?.total?.toLocaleString("es") ?? 0} clientes</span>
              )
            }
          >
            <TableHeader>
              <TableColumn>CLIENTE</TableColumn>
              <TableColumn>SUCURSAL</TableColumn>
              <TableColumn>MUNICIPIO</TableColumn>
              <TableColumn>TIPO</TableColumn>
              <TableColumn>GEO</TableColumn>
              <TableColumn>CÓDIGO</TableColumn>
              <TableColumn>FECHA</TableColumn>
            </TableHeader>
            <TableBody
              items={lista?.data ?? []}
              isLoading={cargandoLista}
              loadingContent={<Spinner label="Cargando…" />}
              emptyContent="Sin clientes para estos filtros"
            >
              {(c: ClienteRow) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell>{c.sucursal?.codigo || c.sucursal?.nombre || "—"}</TableCell>
                  <TableCell>{c.municipio || "—"}</TableCell>
                  <TableCell>{c.tipoCliente || "—"}</TableCell>
                  <TableCell>
                    {c.latitud != null ? (
                      <Chip size="sm" color="success" variant="flat">sí</Chip>
                    ) : (
                      <Chip size="sm" color="default" variant="flat">no</Chip>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-default-500">{c.codigo || "—"}</TableCell>
                  <TableCell className="text-xs">{fmtFecha(c.updatedAt)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardBody>
    </Card>

      {/* Qué trajo esa sincronización. En modal y no desplegado en la lista: son
          hasta 200 líneas y dentro de una caja de cuatro filas no se lee nada. */}
      <Modal
        isOpen={detalleAbierto}
        scrollBehavior="inside"
        size="3xl"
        onClose={onDetalleClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Qué cambió</span>
            <span className="text-xs font-normal text-default-500">
              {fmtFecha(syncVisto?.cuando)}
              {syncVisto?.resultado
                ? ` · ${syncVisto.resultado.actualizados} cambiaron · ${syncVisto.resultado.errores} errores`
                : ""}
            </span>
          </ModalHeader>
          <ModalBody className="text-sm">
            {(syncVisto?.resultado?.erroresDetalle?.length ?? 0) > 0 && (
              <div className="rounded-md bg-danger-50 p-2 text-xs text-danger-700">
                <b>Motivos de los errores:</b>
                <ul className="list-disc pl-4">
                  {syncVisto!.resultado!.erroresDetalle!.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {(syncVisto?.resultado?.cambios?.length ?? 0) === 0 ? (
              // Las sincronizaciones anteriores a este cambio no guardaron el
              // detalle. Decirlo es mejor que enseñar un vacío que parece un fallo.
              <p className="text-default-500">
                Esta sincronización no guardó el detalle: es anterior al cambio que
                empezó a registrarlo. La próxima que corras sí lo trae.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {syncVisto!.resultado!.cambios!.map((c, i) => (
                  <div key={`${c.cliente}-${i}`} className="border-b border-default-100 pb-1">
                    <b>{c.cliente}</b>
                    {c.sucursal ? (
                      <span className="text-default-400"> · {c.sucursal}</span>
                    ) : null}
                    <ul className="pl-4 text-xs">
                      {c.campos.map((f) => (
                        <li key={f.campo}>
                          {f.campo}:{" "}
                          <span className="text-default-400">{f.antes ?? "vacío"}</span>
                          {" → "}
                          <span className="text-success">{f.despues ?? "vacío"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {(syncVisto!.resultado!.actualizados ?? 0) >
                  syncVisto!.resultado!.cambios!.length && (
                  <p className="text-xs text-default-400">
                    …y{" "}
                    {syncVisto!.resultado!.actualizados -
                      syncVisto!.resultado!.cambios!.length}{" "}
                    más. Se guardan los primeros 200.
                  </p>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onDetalleClose}>
              Cerrar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};
