import { useCallback, useEffect, useState } from "react";

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

      {/* Cuántos van por sucursal en la última hora, y cuál fue el último de cada una.
          Escrito entero —«8 pedidos en la última hora»— y no «8 en 1 h»: abreviado hay
          que preguntarlo, y una etiqueta que hay que preguntar no sirve. */}
      {entrando.slice(0, 4).map((e) => (
        <span key={e.sucursalId ?? e.sucursal} className="text-default-600">
          <strong>{e.sucursal}</strong>: <span className="tabular-nums">{e.entrados}</span>{" "}
          {e.entrados === 1 ? "pedido" : "pedidos"} en la última hora
          {/* De cuántos vendedores: distingue «uno subiendo lo suyo» de «la calle entera
              metiendo pedidos», que no es lo mismo cuando alguien pregunta si va lento. */}
          {e.vendedores > 1 && <> de {e.vendedores} vendedores</>} · el último{" "}
          <span className="font-mono">{e.ultimoFolio}</span>
          {e.ultimoVendedor && <>, de {e.ultimoVendedor}</>}
          {e.ultimoCliente && <> para {e.ultimoCliente}</>}
          , <span className="text-default-400">{hace(e.ultimoAt, ahora)}</span>
        </span>
      ))}
      {entrando.length > 4 && (
        <span className="text-default-500">y {entrando.length - 4} sucursales más</span>
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
