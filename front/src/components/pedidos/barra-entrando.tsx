import {
  Drawer, DrawerBody, DrawerContent, DrawerHeader,
  Modal, ModalBody, ModalContent, ModalHeader,
} from "@heroui/react";
import { ElementType, useCallback, useEffect, useState } from "react";

import { usePantallaChica } from "@/hooks/pantalla";

import { getApiBaseUrl } from "@/config";
import { cn } from "@/lib/utils";

/**
 * Lo que está entrando ahora mismo, en la cabecera del listado de pedidos.
 *
 * # Por qué sustituye al «En vivo»
 *
 * Ahí ponía «En vivo», que quiere decir que el canal de eventos está abierto. Eso no es lo
 * que pregunta nadie. **La pregunta que llega cada cinco segundos es «¿ya entró mi
 * pedido?»**, y un chip verde diciendo «En vivo» no la contesta: está igual de verde con
 * cien pedidos entrando que con la tarde entera parada.
 *
 * Ahora dice lo que de verdad pasa: cuántos han entrado en la última hora, por qué
 * sucursal, cuál fue el último y hace cuánto. Y si alguien está subiendo un archivo, por
 * qué línea va.
 *
 * # Nunca se queda en blanco
 *
 * Aunque no haya entrado nada en la última hora, enseña el último pedido que entró, cuando
 * fuera. Una barra que a veces no está es peor que no tenerla: quien la mira no sabe si es
 * que no entra nada o es que está rota.
 */
const api = getApiBaseUrl;

interface Trabajo {
  jobId: string;
  archivo: string | null;
  lote: number | null;
  deLotes: number | null;
  filas: number;
  hechos: number;
  creados: number;
  actualizados: number;
  fallidos: number;
  desdeAt: number | null;
  /** De dónde viene: la ingesta automática (n8n) o alguien subiendo por la pantalla. */
  origen?: "n8n" | "pantalla";
}

interface Cola {
  activa: boolean;
  ahora?: number;
  ventanaMin?: number;
  trabajando?: boolean;
  ultimo?: { folio: string; at: number; sucursal: string; vendedor: string | null; cliente: string | null } | null;
  entrando?: Array<{
    sucursalId: string | null;
    sucursal: string;
    entrados: number;
    ultimoAt: number;
    ultimoFolio: string;
    ultimoVendedor: string | null;
    ultimoCliente: string | null;
    vendedores: number;
  }>;
  sucursales?: Array<{ sucursal: string; activos: Trabajo[]; enEspera: number; filasEnEspera: number }>;
  /** Archivos que ACABAN de entrar. Lo único que se ve cuando las tandas son pequeñas. */
  archivos?: Array<{
    archivo: string | null;
    sucursal: string;
    origen: "n8n" | "pantalla";
    filas: number;
    creados: number;
    actualizados: number;
    fallidos: number;
    /** Cuánto tardó en procesarse, en milisegundos. */
    ms?: number;
    at: number;
  }>;
}

/** «1,2 s» / «3 min». Lo que tardó en procesarse un archivo. */
function tardo(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

  return `${Math.round(ms / 60_000)} min`;
}

/** «hace 40 s» / «hace 3 min» / «hace 2 h». Es lo que calma a quien está esperando. */
function hace(at: number, ahora: number): string {
  const s = Math.max(Math.round((ahora - at) / 1000), 0);

  if (s < 90) return `hace ${s} s`;
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;

  return `hace ${Math.round(s / 3600)} h`;
}

export function BarraEntrando({ conectado }: { conectado: boolean }) {
  const [cola, setCola] = useState<Cola | null>(null);
  // Con varias sucursales la línea se resume; esto abre el detalle de todas.
  const [abierto, setAbierto] = useState(false);

  /**
   * Modal en escritorio, cajón en móvil. Es la regla de la casa en todo Procovar, y el
   * mismo envase que usa el detalle del pedido en esta misma pantalla.
   *
   * Antes el detalle se desplegaba debajo, dentro de la propia barra: empujaba la lista
   * de pedidos hacia abajo y dejaba cuatro frases apretadas en un hueco que no es para
   * leer. Aquí tiene sitio.
   */
  const pantallaChica = usePantallaChica();
  const Envase: ElementType = pantallaChica ? Drawer : Modal;
  const EnvaseContenido: ElementType = pantallaChica ? DrawerContent : ModalContent;
  const EnvaseCabecera: ElementType = pantallaChica ? DrawerHeader : ModalHeader;
  const EnvaseCuerpo: ElementType = pantallaChica ? DrawerBody : ModalBody;

  const cargar = useCallback(async () => {
    try {
      setCola(await fetch(`${api()}/orders/cola`).then((r) => r.json()));
    } catch {
      // Un fallo de red deja lo último que se supo y se reintenta al ciclo siguiente.
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    // Deprisa mientras hay un archivo procesándose —la barra tiene que moverse— y
    // despacio el resto del tiempo, que es casi siempre.
    const t = setInterval(cargar, cola?.trabajando ? 2000 : 15000);

    return () => clearInterval(t);
  }, [cargar, cola?.trabajando]);

  const ahora = cola?.ahora ?? Date.now();
  const entrando = cola?.entrando ?? [];
  const subiendo = (cola?.sucursales ?? []).filter((s) => s.activos.length > 0 || s.enEspera > 0);
  const archivos = cola?.archivos ?? [];
  // Algo entró hace menos de dos minutos: eso es «ahora mismo» y merece el punto latiendo.
  const caliente = entrando.length > 0 && ahora - entrando[0].ultimoAt < 120_000;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-2.5 py-1",
          caliente ? "bg-success-100 text-success-700" : "bg-default-100 text-default-600",
        )}
      >
        {/* El punto late SÓLO si de verdad está cayendo algo. Latiendo siempre sería
            mentira, y es justo la confianza que no hay que romper. */}
        <span
          className={cn("size-2 rounded-full", caliente ? "animate-pulse bg-success-500" : "bg-default-400")}
        />
        {!conectado ? "Conectando…" : caliente ? "Entrando pedidos" : "Sin movimiento ahora"}
      </span>

      {/* UNA SOLA SUCURSAL: cabe la frase entera y se lee de corrido. */}
      {entrando.length === 1 && (
        <span className="text-default-600">
          <strong>{entrando[0].sucursal}</strong>: <span className="tabular-nums">{entrando[0].entrados}</span>{" "}
          {entrando[0].entrados === 1 ? "pedido" : "pedidos"} en la última hora
          {entrando[0].vendedores > 1 && <> de {entrando[0].vendedores} vendedores</>} · el último{" "}
          <span className="font-mono">{entrando[0].ultimoFolio}</span>
          {entrando[0].ultimoVendedor && <>, de {entrando[0].ultimoVendedor}</>}
          {entrando[0].ultimoCliente && <> para {entrando[0].ultimoCliente}</>},{" "}
          <span className="text-default-400">{hace(entrando[0].ultimoAt, ahora)}</span>
        </span>
      )}

      {/* VARIAS SUCURSALES: cuatro frases seguidas son un párrafo, no una barra.
          Se resume en una línea —el total, una pastilla por sucursal y el último de
          todos— y el detalle con vendedor y cliente se abre al pulsar. */}
      {entrando.length > 1 && (
        <>
          {/* Todo en una línea. Cada pieza que se quita es una que cabe:
              - las pastillas con fondo y padding ocupaban el doble que «STG 2»;
              - el folio del último sobra en el resumen —con cuatro sucursales lo que
                importa es cuánto y hace cuánto—, y sigue estando en el detalle y en el
                título de cada sucursal al pasar el ratón. */}
          <span className="text-default-600">
            <strong className="tabular-nums">
              {entrando.reduce((n, e) => n + e.entrados, 0)}
            </strong>{" "}
            pedidos en la última hora
          </span>

          <span className="text-default-600">
            {entrando.map((e, i) => (
              <span
                key={e.sucursalId ?? e.sucursal}
                title={`${e.sucursal}: ${e.entrados} en la última hora · el último ${e.ultimoFolio}${e.ultimoVendedor ? `, de ${e.ultimoVendedor}` : ""}`}
              >
                {i > 0 && <span className="text-default-300"> · </span>}
                {e.sucursal} <span className="font-medium tabular-nums">{e.entrados}</span>
              </span>
            ))}
          </span>

          <span className="text-default-400">el último {hace(entrando[0].ultimoAt, ahora)}</span>

        </>
      )}

      {/* El detalle es de TODO —archivos y sucursales—, así que el botón va fuera del
          bloque de «varias sucursales»: con una sola, o sin ninguna pero con archivos
          entrando, también hay algo que enseñar. */}
      {(entrando.length > 0 || archivos.length > 0) && (
        <>
          <button className="underline text-default-500" type="button" onClick={() => setAbierto(true)}>
            ver detalle
          </button>

          <Envase
            isOpen={abierto}
            {...(pantallaChica ? { placement: "right" } : { size: "2xl", scrollBehavior: "inside" })}
            onOpenChange={setAbierto}
          >
            <EnvaseContenido>
              <EnvaseCabecera className="flex flex-col gap-0.5">
                <span>Qué está entrando</span>
                <span className="text-sm font-normal text-default-500">
                  Los archivos que han entrado y los pedidos, en la última hora
                </span>
              </EnvaseCabecera>
              <EnvaseCuerpo className="pb-6">
                {archivos.length > 0 && (
                  <div className="mb-4 flex flex-col gap-2">
                    <p className="text-sm font-medium text-default-700">
                      Archivos de la última hora
                    </p>
                    {archivos.map((a, i) => (
                      <div
                        key={`${a.at}-${i}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-medium border-medium border-default-200 p-3"
                      >
                        <span className="min-w-0 break-all text-sm">
                          {a.archivo ?? (a.origen === "n8n" ? "de la ingesta, sin nombre" : "subido a mano")}
                        </span>
                        <span className="text-xs text-default-500">
                          {a.sucursal !== "Sin sucursal" && <>{a.sucursal} · </>}
                          <span className="tabular-nums">{(a.creados + a.actualizados).toLocaleString("es")}</span>{" "}
                          pedidos
                          {a.fallidos > 0 && (
                            <span className="text-warning-600"> · {a.fallidos} con problema</span>
                          )}
                          {a.ms != null && <> · {tardo(a.ms)}</>} · {hace(a.at, ahora)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="mb-2 text-sm font-medium text-default-700">Por sucursal</p>
                <div className="flex flex-col gap-3">
                  {entrando.map((e) => (
                    <div
                      key={`d-${e.sucursalId ?? e.sucursal}`}
                      className="flex flex-col gap-0.5 rounded-medium border-medium border-default-200 p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{e.sucursal}</span>
                        <span className="text-sm text-default-500">
                          <span className="tabular-nums font-medium text-default-700">{e.entrados}</span>{" "}
                          {e.entrados === 1 ? "pedido" : "pedidos"}
                          {e.vendedores > 1 && <> · {e.vendedores} vendedores</>}
                        </span>
                      </div>
                      <div className="text-sm text-default-600">
                        El último <span className="font-mono">{e.ultimoFolio}</span>
                        {e.ultimoVendedor && <>, de {e.ultimoVendedor}</>}
                        {e.ultimoCliente && <> para {e.ultimoCliente}</>}
                      </div>
                      <div className="text-xs text-default-400">{hace(e.ultimoAt, ahora)}</div>
                    </div>
                  ))}
                </div>
              </EnvaseCuerpo>
            </EnvaseContenido>
          </Envase>
        </>
      )}

      {/* Nada en la última hora: se dice cuál fue el último, en vez de quedarse mudo. */}
      {entrando.length === 0 && cola?.ultimo && (
        <span className="text-default-500">
          Nada en la última hora. El último pedido fue{" "}
          <span className="font-mono">{cola.ultimo.folio}</span> de {cola.ultimo.sucursal}
          {cola.ultimo.vendedor && <>, vendido por {cola.ultimo.vendedor}</>}
          {cola.ultimo.cliente && <> para {cola.ultimo.cliente}</>}, {hace(cola.ultimo.at, ahora)}
        </span>
      )}

      {/* ARCHIVOS QUE ACABAN DE ENTRAR, en corto.
          La frase entera —«15 archivos entraron en la última hora · el último Copia de
          andy.almanza.pedidos.2026-09-11.csv (CAM) con 13 pedidos, hace 5 min»— no cabe
          en la línea y se llevaba una entera para ella sola. Aquí va lo justo, el nombre
          recortado, y la lista completa con cuántos pedidos y cuánto tardó cada uno está
          en el detalle. */}
      {archivos.length > 0 && (
        <span className="flex min-w-0 items-baseline gap-1 text-default-600">
          <strong className="tabular-nums">{archivos.length}</strong>
          <span>{archivos.length === 1 ? "archivo" : "archivos"}</span>
          <span className="text-default-300">·</span>
          <span className="max-w-[16rem] truncate" title={archivos[0].archivo ?? ""}>
            {archivos[0].archivo ?? "sin nombre"}
          </span>
          <span className="shrink-0 text-default-400">
            {archivos[0].sucursal !== "Sin sucursal" && `(${archivos[0].sucursal}) `}
            {hace(archivos[0].at, ahora)}
          </span>
        </span>
      )}

      {/* Y si alguien está subiendo un archivo, por qué línea va. */}
      {subiendo.map((s) => {
        const t = s.activos[0];
        const pct = t && t.filas > 0 ? Math.min(Math.round((t.hechos / t.filas) * 100), 100) : 0;

        return (
          <span key={s.sucursal} className="inline-flex items-center gap-2 text-default-700">
            <span className="inline-block h-1 w-24 overflow-hidden rounded-full bg-default-200 align-middle">
              <span
                className={
                  t && t.filas > 0
                    ? "block h-full rounded-full bg-primary transition-all duration-500"
                    : "block h-full w-1/3 animate-pulse rounded-full bg-primary"
                }
                style={t && t.filas > 0 ? { width: `${pct}%` } : undefined}
              />
            </span>
            {t ? (
              <>
                <strong>{s.sucursal}</strong>{" "}
                {t.origen === "n8n" ? "metiendo" : "subiendo"}{" "}
                {t.archivo ?? (t.origen === "n8n" ? "un archivo de la ingesta" : "un archivo")}
                {t.deLotes && t.deLotes > 1 && ` (trozo ${t.lote}/${t.deLotes})`} · línea{" "}
                <span className="tabular-nums">
                  {t.hechos.toLocaleString("es")} de {t.filas.toLocaleString("es")}
                </span>
                {t.fallidos > 0 && <span className="text-warning-600"> · {t.fallidos} con problema</span>}
              </>
            ) : (
              <>
                <strong>{s.sucursal}</strong> {s.enEspera} en cola ({s.filasEnEspera.toLocaleString("es")} filas)
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
