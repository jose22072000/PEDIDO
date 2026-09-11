import { Card, CardBody, Chip, Progress } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Por dónde va la subida de pedidos, por sucursal.
 *
 * # Para qué
 *
 * Mientras un archivo se importa, quien lo subió no ve nada: sube, y a esperar. Y como no
 * ve nada, **pregunta cada cinco segundos si su pedido ya entró**. Esto contesta esa
 * pregunta sin que tenga que preguntarla: qué se está procesando ahora, por dónde va, y
 * cuánto queda esperando.
 *
 * # Dos decisiones
 *
 * - **Se enseña también cuando no hay nada.** Esconderlo al terminar deja al operador sin
 *   saber si es que ya entró todo o es que la pantalla no funciona. Un «no hay nada
 *   subiéndose» es una respuesta; una pantalla en blanco, no.
 * - **Se pregunta rápido sólo mientras hay trabajo** (3 s), y despacio cuando no lo hay
 *   (20 s). Preguntar cada tres segundos todo el día es machacar la API para enseñar un
 *   cero.
 *
 * Cada uno ve su sucursal; quien las ve todas, todas — así se distingue «va lento lo mío»
 * de «va lento todo».
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

interface Cola {
  activa: boolean;
  nota?: string;
  ahora?: number;
  trabajando?: boolean;
  sucursales: EnSucursal[];
}

/** «lleva 42 s» / «lleva 3 min». Es lo que calma a quien está esperando. */
function llevando(desdeAt: number | null, ahora: number): string {
  if (!desdeAt) return "";

  const s = Math.max(Math.round((ahora - desdeAt) / 1000), 0);

  return s < 90 ? `lleva ${s} s` : `lleva ${Math.round(s / 60)} min`;
}

export function ColaSubidas() {
  const [cola, setCola] = useState<Cola | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCola(await fetch(`${api()}/orders/cola`).then((r) => r.json()));
    } catch {
      // Un fallo de red no tiene que ensuciar la pantalla de pedidos: se deja lo último
      // que se supo y se reintenta en el siguiente ciclo.
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const rapido = cola?.trabajando === true;
    const t = setInterval(cargar, rapido ? 3000 : 20000);

    return () => clearInterval(t);
  }, [cargar, cola?.trabajando]);

  if (!cola) return null;

  // Sin cola configurada las subidas se procesan al momento: no hay nada que mirar y
  // decirlo evita que alguien busque una barra que no va a aparecer nunca.
  if (!cola.activa) return null;

  const ahora = cola.ahora ?? Date.now();
  const conAlgo = cola.sucursales.filter((s) => s.activos.length > 0 || s.enEspera > 0);

  return (
    <Card>
      <CardBody className="gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Subidas de pedidos</span>
          {conAlgo.length === 0 ? (
            <Chip color="default" size="sm" variant="flat">
              No hay nada subiéndose
            </Chip>
          ) : (
            <Chip color="primary" size="sm" variant="flat">
              Entrando datos
            </Chip>
          )}
          <span className="ml-auto text-xs text-default-400">se actualiza solo</span>
        </div>

        {conAlgo.length === 0 ? (
          <p className="text-xs text-default-500">
            Todo lo que se subió ya está procesado. Si falta un pedido, no es que esté en cola.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {conAlgo.map((s) => (
              <div key={s.sucursalId ?? s.sucursal} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{s.sucursal}</span>
                  {s.enEspera > 0 && (
                    <span className="text-xs text-default-500">
                      {s.enEspera} {s.enEspera === 1 ? "trozo" : "trozos"} esperando ·{" "}
                      {s.filasEnEspera.toLocaleString("es")} filas
                      {s.archivosEnEspera?.length > 0 && ` · ${s.archivosEnEspera.slice(0, 3).join(", ")}`}
                    </span>
                  )}
                </div>

                {s.activos.map((t) => {
                  const pct = t.filas > 0 ? Math.min(Math.round((t.hechos / t.filas) * 100), 100) : 0;
                  const entrados = t.creados + t.actualizados;

                  return (
                    <div key={t.jobId} className="flex flex-col gap-1">
                      {/* QUÉ archivo. Es lo primero que busca quien acaba de subir: sin
                          el nombre, una barra es de cualquiera. */}
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-medium text-default-700">
                          {t.archivo ?? "archivo sin nombre"}
                        </span>
                        {t.deLotes && t.deLotes > 1 && (
                          <span className="text-default-500">
                            trozo {t.lote} de {t.deLotes}
                          </span>
                        )}
                      </div>

                      <Progress
                        aria-label={`Progreso de ${t.archivo ?? "la subida"} en ${s.sucursal}`}
                        // Hasta que llega el primer aviso de progreso no se sabe nada:
                        // una barra en cero parece parada, y la indeterminada dice la
                        // verdad — está trabajando y todavía no hay cifra.
                        isIndeterminate={t.filas === 0}
                        size="sm"
                        value={pct}
                      />

                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-default-500">
                        {t.filas > 0 ? (
                          <>
                            {/* Por QUÉ LÍNEA va. «350 de 500» se entiende sin explicar. */}
                            <span className="tabular-nums">
                              línea <strong>{t.hechos.toLocaleString("es")}</strong> de{" "}
                              {t.filas.toLocaleString("es")} ({pct}%)
                            </span>
                            {/* Y QUÉ está entrando: sin esto no se distingue avanzar de
                                fallar fila por fila. */}
                            <span className="tabular-nums">
                              {entrados.toLocaleString("es")} entrados
                              {t.creados > 0 && ` · ${t.creados.toLocaleString("es")} nuevos`}
                              {t.actualizados > 0 && ` · ${t.actualizados.toLocaleString("es")} actualizados`}
                            </span>
                            {t.fallidos > 0 && (
                              <span className="tabular-nums text-warning-600">
                                {t.fallidos.toLocaleString("es")} con problema
                              </span>
                            )}
                          </>
                        ) : (
                          <span>leyendo el archivo y buscando los vendedores</span>
                        )}
                        <span>{llevando(t.desdeAt, ahora)}</span>
                      </div>
                    </div>
                  );
                })}

                {s.activos.length === 0 && s.enEspera > 0 && (
                  <p className="text-xs text-default-500">en cola, todavía sin empezar</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
