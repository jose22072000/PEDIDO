import { Card, CardBody, CardHeader, Chip, Spinner, addToast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Las DOS direcciones entre PEDIDO y el reparto, y si están vivas.
 *
 * Hasta ahora esto no se veía en ninguna parte: el reparto preguntaba cada minuto y
 * nadie sabía si llegaba o no. Ahora PEDIDO avisa —deja el aviso en una cola— y el
 * reparto escribe de vuelta los estados de la entrega.
 *
 * Lo que se enseña aquí NO es «está configurado», que eso no dice nada: un sincronizado
 * parado tiene la casilla de «activo» igual de verde que uno que va bien. Lo que se
 * enseña es si está PASANDO algo: cuántos avisos esperan, cuántos cogió el reparto y no
 * terminó, cuánto hace del último, y cuántos estados entraron hoy de vuelta.
 */
type Estado = {
  enviar: {
    encendido: boolean;
    stream: string;
    redis: boolean;
    hay: number | null;
    sinTerminar: number | null;
    ultimoAviso: number | null;
    grupoCreado: boolean;
    motivos: { motivo: string; que: string }[];
  };
  recibir: {
    por: string;
    recibidosHoy: number;
    ultimo: { folio: string; estado: string | null; cuando: string; sucursalId: string | null } | null;
  };
};

const hace = (ms: number | null | undefined) => {
  if (!ms) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));

  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;

  return `hace ${Math.round(s / 86400)} días`;
};

const cuando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export const RepartoSyncPanel = () => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${getApiBaseUrl()}/sincronizacion/reparto`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo leer el estado");
      setEstado(data);
    } catch (e) {
      addToast({
        title: "No se pudo leer la sincronización",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, []);

  // Se refresca solo: es una pantalla para mirar mientras pasa algo.
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 30_000);

    return () => clearInterval(t);
  }, [cargar]);

  if (cargando && !estado) {
    return (
      <div className="flex justify-center py-16">
        <Spinner color="primary" />
      </div>
    );
  }
  if (!estado) return null;

  const { enviar, recibir } = estado;

  /**
   * El semáforo del envío. Tres estados que quieren decir cosas distintas y no se
   * pueden mezclar: apagado, encendido sin nadie escuchando, y funcionando.
   */
  const salud = !enviar.encendido
    ? { color: "default" as const, texto: "Apagado" }
    : !enviar.redis
      ? { color: "danger" as const, texto: "Sin Redis" }
      : !enviar.grupoCreado
        ? { color: "warning" as const, texto: "Nadie está leyendo" }
        : (enviar.sinTerminar ?? 0) > 50
          ? { color: "warning" as const, texto: "Se está acumulando" }
          : { color: "success" as const, texto: "Funcionando" };

  const dato = (v: number | null) => (v == null ? "—" : String(v));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* ------------------------------------------------------------ ENVIAR */}
      <Card>
        <CardHeader className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold">Enviar al reparto</p>
            <p className="text-xs text-default-500">
              PEDIDO deja un aviso en cuanto un pedido se puede repartir. El reparto lo lee.
            </p>
          </div>
          <Chip color={salud.color} size="sm" variant="flat">
            {salud.texto}
          </Chip>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-default-400">Esperando</p>
              <p className="text-2xl font-bold tabular-nums">{dato(enviar.hay)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-default-400">Sin terminar</p>
              <p className="text-2xl font-bold tabular-nums">{dato(enviar.sinTerminar)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-default-400">Último aviso</p>
              <p className="text-sm font-semibold">{hace(enviar.ultimoAviso)}</p>
            </div>
          </div>

          <div className="rounded-medium bg-default-100 p-3">
            <p className="mb-2 text-xs font-semibold text-default-600">Se avisa cuando…</p>
            <ul className="flex flex-col gap-1">
              {enviar.motivos.map((m) => (
                <li key={m.motivo} className="text-xs text-default-600">
                  <span className="font-mono text-[11px] text-primary">{m.motivo}</span> — {m.que}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-default-400">
            Cola: <span className="font-mono">{enviar.stream}</span>
            {!enviar.grupoCreado && enviar.encendido && (
              <span className="block mt-1 text-warning">
                El reparto todavía no ha creado su grupo de lectura: los avisos se acumulan esperándolo.
              </span>
            )}
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ RECIBIR */}
      <Card>
        <CardHeader className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold">Recibir del reparto</p>
            <p className="text-xs text-default-500">
              El reparto escribe aquí en qué va cada entrega: despachado, en tránsito, entregado…
            </p>
          </div>
          <Chip color={recibir.recibidosHoy > 0 ? "success" : "default"} size="sm" variant="flat">
            {recibir.recibidosHoy > 0 ? "Funcionando" : "Sin movimiento hoy"}
          </Chip>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-default-400">Estados hoy</p>
              <p className="text-2xl font-bold tabular-nums">{recibir.recibidosHoy}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-default-400">El último</p>
              <p className="text-sm font-semibold">{cuando(recibir.ultimo?.cuando)}</p>
            </div>
          </div>

          {recibir.ultimo && (
            <div className="rounded-medium bg-default-100 p-3 text-xs">
              <p className="font-mono text-primary">{recibir.ultimo.folio}</p>
              <p className="text-default-600">
                {recibir.ultimo.estado || "sin estado"} · {recibir.ultimo.sucursalId || "sin sucursal"}
              </p>
            </div>
          )}

          <p className="text-[11px] text-default-400">
            Entra por <span className="font-mono">{recibir.por}</span>, con la clave de servicio del
            reparto. Esta dirección no tiene interruptor: si la clave está mal, el reparto recibe un
            401 y se ve en su propio registro.
          </p>
        </CardBody>
      </Card>

      <p className="col-span-full text-center text-[11px] text-default-400">
Se actualiza solo cada 30 segundos.
      </p>
    </div>
  );
};
