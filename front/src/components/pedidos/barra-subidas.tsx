import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * La barra de «se están metiendo datos ahora mismo».
 *
 * # Para qué
 *
 * Mientras un archivo se importa, quien lo subió no ve nada y **pregunta cada cinco
 * segundos si su pedido ya entró**. Esta barra contesta esa pregunta sin que nadie tenga
 * que preguntarla: qué archivo se está metiendo y por qué línea va, en vivo.
 *
 * # Por qué es una barra y no una pantalla
 *
 * Una pantalla hay que ir a mirarla, y quien está facturando no va a ir. La barra sale
 * sola, en cualquier sitio del panel, **sólo cuando hay trabajo**, y se va sola al
 * terminar. Va abajo y no arriba para no empujar el contenido ni tapar el menú.
 *
 * # Cuando acaba
 *
 * Se queda unos segundos diciendo qué entró —«terminó · 482 entrados»— y desaparece. Si se
 * fuera de golpe, quien estaba mirando no sabría si acabó o si se rompió.
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
}

interface EnSucursal {
  sucursalId: string | null;
  sucursal: string;
  activos: Trabajo[];
  enEspera: number;
  filasEnEspera: number;
  archivosEnEspera: string[];
}

/** Lo que ha entrado de verdad en los últimos minutos, venga por donde venga. */
interface Entrando {
  sucursalId: string | null;
  sucursal: string;
  entrados: number;
  ultimoAt: number;
  ultimoFolio: string;
}

interface Cola {
  activa: boolean;
  ahora?: number;
  ventanaMin?: number;
  trabajando?: boolean;
  entrando?: Entrando[];
  sucursales: EnSucursal[];
}

/** Cuánto lleva. Es lo que calma a quien espera: «lleva 40 s» no es lo mismo que nada. */
function llevando(desdeAt: number | null, ahora: number): string {
  if (!desdeAt) return "";

  const s = Math.max(Math.round((ahora - desdeAt) / 1000), 0);

  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export function BarraSubidas() {
  const [cola, setCola] = useState<Cola | null>(null);
  const [acabado, setAcabado] = useState<string | null>(null);
  // Lo que había en el ciclo anterior, para saber si acaba de terminar algo.
  const anterior = useRef<{ trabajando: boolean; entrados: number }>({ trabajando: false, entrados: 0 });

  const cargar = useCallback(async () => {
    try {
      const c: Cola = await fetch(`${api()}/orders/cola`).then((r) => r.json());
      const entrados = (c.sucursales ?? []).reduce(
        (n, s) => n + s.activos.reduce((m, t) => m + t.creados + t.actualizados, 0),
        0,
      );
      const trabajando = Boolean(c.trabajando) || (c.sucursales ?? []).some((s) => s.enEspera > 0);

      // Estaba trabajando y ya no: eso es que acaba de terminar.
      if (anterior.current.trabajando && !trabajando) {
        setAcabado(
          anterior.current.entrados > 0
            ? `Terminó · ${anterior.current.entrados.toLocaleString("es")} pedidos entraron`
            : "Terminó de procesar",
        );
        setTimeout(() => setAcabado(null), 12000);
      }

      anterior.current = { trabajando, entrados: trabajando ? entrados : anterior.current.entrados };
      setCola(c);
    } catch {
      // Un fallo de red no tiene que ensuciar la pantalla: se reintenta al ciclo siguiente.
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    /**
     * Deprisa mientras hay trabajo, despacio cuando no.
     *
     * Con trabajo la barra tiene que moverse de verdad; sin trabajo, preguntar cada dos
     * segundos todo el día es machacar la API para enseñar un cero. Lo peor que pasa al
     * arrancar una subida es que la barra tarde hasta 15 s en aparecer.
     */
    const trabajando = Boolean(cola?.trabajando) || (cola?.sucursales ?? []).some((s) => s.enEspera > 0);
    const t = setInterval(cargar, trabajando ? 2000 : 15000);

    return () => clearInterval(t);
  }, [cargar, cola?.trabajando, cola?.sucursales]);

  if (!cola?.activa) return null;

  const ahora = cola.ahora ?? Date.now();
  const conAlgo = (cola.sucursales ?? []).filter((s) => s.activos.length > 0 || s.enEspera > 0);
  const entrando = cola.entrando ?? [];

  /**
   * Nada que decir: ni archivos, ni pedidos recientes, ni un «acabó» que enseñar.
   *
   * Si no hay nada, la barra no existe. Pero basta con que haya entrado UN pedido en los
   * últimos minutos para enseñarla: eso es exactamente lo que contesta la pregunta que la
   * hizo falta —«¿siguen entrando?»—.
   */
  if (conAlgo.length === 0 && entrando.length === 0 && !acabado) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-default-200 bg-content1/95 shadow-lg backdrop-blur">
      <div className="container mx-auto max-w-7xl px-4 py-2">
        {conAlgo.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {acabado && <span className="text-sm text-success-600">{acabado}</span>}

            {entrando.length > 0 && (
              <>
                {/* El punto late SÓLO si de verdad está cayendo algo ahora mismo.
                    Latiendo siempre sería mentira: a los veinte minutos sin un pedido,
                    un punto verde parpadeando dice «está entrando» cuando no entra nada,
                    y es justo la confianza que hay que no romper. */}
                <span className="flex items-center gap-1.5 font-medium text-default-700">
                  {ahora - (entrando[0]?.ultimoAt ?? 0) < 120_000 ? (
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-success" />
                    </span>
                  ) : (
                    <span className="inline-flex size-2 rounded-full bg-default-400" />
                  )}
                  {ahora - (entrando[0]?.ultimoAt ?? 0) < 120_000 ? "Entrando pedidos" : "Último pedido"}
                </span>
                {entrando.slice(0, 4).map((e) => (
                  <span key={e.sucursalId ?? e.sucursal} className="text-default-600">
                    <strong>{e.sucursal}</strong>{" "}
                    <span className="tabular-nums">{e.entrados}</span> en{" "}
                    {(cola.ventanaMin ?? 60) >= 60 ? "1 h" : `${cola.ventanaMin} min`} ·{" "}
                    <span className="font-mono">{e.ultimoFolio}</span>{" "}
                    <span className="text-default-400">hace {llevando(e.ultimoAt, ahora)}</span>
                  </span>
                ))}
                {entrando.length > 4 && (
                  <span className="text-default-500">y {entrando.length - 4} sucursales más</span>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Como mucho dos sucursales a la vez: esto es una barra, no un informe. */}
            {conAlgo.slice(0, 2).map((s) => {
              const t = s.activos[0];
              const pct = t && t.filas > 0 ? Math.min(Math.round((t.hechos / t.filas) * 100), 100) : 0;

              return (
                <div key={s.sucursalId ?? s.sucursal} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                    {/* El punto verde que late: dice «esto está vivo» sin una palabra. */}
                    <span className="flex items-center gap-1.5 font-medium text-default-700">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-success" />
                      </span>
                      {s.sucursal}
                    </span>

                    {t ? (
                      <>
                        <span className="truncate font-medium">{t.archivo ?? "archivo sin nombre"}</span>
                        {t.deLotes && t.deLotes > 1 && (
                          <span className="text-default-500">
                            trozo {t.lote}/{t.deLotes}
                          </span>
                        )}
                        {t.filas > 0 ? (
                          <span className="tabular-nums text-default-600">
                            línea <strong>{t.hechos.toLocaleString("es")}</strong> de{" "}
                            {t.filas.toLocaleString("es")}
                          </span>
                        ) : (
                          <span className="text-default-500">leyendo el archivo</span>
                        )}
                        <span className="tabular-nums text-default-500">
                          {(t.creados + t.actualizados).toLocaleString("es")} entrados
                          {t.fallidos > 0 && (
                            <span className="text-warning-600"> · {t.fallidos} con problema</span>
                          )}
                        </span>
                        <span className="text-default-400">{llevando(t.desdeAt, ahora)}</span>
                      </>
                    ) : (
                      <span className="text-default-500">en cola, aún sin empezar</span>
                    )}

                    {s.enEspera > 0 && (
                      <span className="ml-auto text-default-500">
                        +{s.enEspera} esperando ({s.filasEnEspera.toLocaleString("es")} filas)
                      </span>
                    )}
                  </div>

                  {/* La barra en sí. Sin cifra todavía, se mueve sola en vez de quedarse
                      en cero, que parece parada. */}
                  <div className="h-1 w-full overflow-hidden rounded-full bg-default-200">
                    <div
                      className={
                        t && t.filas > 0
                          ? "h-full rounded-full bg-primary transition-all duration-500"
                          : "h-full w-1/3 animate-pulse rounded-full bg-primary"
                      }
                      style={t && t.filas > 0 ? { width: `${pct}%` } : undefined}
                    />
                  </div>
                </div>
              );
            })}

            {conAlgo.length > 2 && (
              <p className="text-xs text-default-500">y {conAlgo.length - 2} sucursales más subiendo</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
