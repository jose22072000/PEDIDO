import { Button, Chip, Input, addToast } from "@heroui/react";
import { useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";
import { useLiveEvents } from "@/hooks/use-live-events";

type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  scope: string;
  activo: boolean;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  usageCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/**
 * Gestión de API keys para otros proyectos/compañeros (solo Super Admin, dentro de
 * Mantenimiento). Emite claves (`pk_...`, se muestran UNA vez), lista con su uso
 * (quién entra/sale: veces + última vez + IP) y permite revocar/borrar.
 */
export const ApiKeysPanel = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState("");
  const [creando, setCreando] = useState(false);
  const [nuevoToken, setNuevoToken] = useState<string | null>(null);

  const cargar = async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api-keys`);

      if (r.ok) setKeys(await r.json());
    } catch {
      // enlace flaky; se reintenta al reabrir
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  // En vivo por SSE, pero SOLO cuando la lista cambia de verdad (crear, editar,
  // revocar, borrar).
  //
  // Antes se recargaba con CUALQUIER evento 'apikey', y el backend emite uno cada
  // vez que se USA una clave (delivery consulta sin parar): la tabla se rehacía
  // cada dos segundos y la pantalla parpadeaba sola. Los contadores de uso se
  // ponen al día al volver a entrar; no valen un parpadeo permanente.
  useLiveEvents(["apikey"], (_ev, lote) => {
    if (lote.some((e) => e.accion !== "change")) void cargar();
  });

  const crear = async () => {
    if (!label.trim()) {
      addToast({ title: "Ponle un nombre al proyecto", color: "warning" });

      return;
    }
    setCreando(true);
    setNuevoToken(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        addToast({ title: data?.error || "No se pudo crear la key", color: "danger" });
      } else {
        setNuevoToken(data.token);
        setLabel("");
        cargar();
      }
    } catch {
      addToast({ title: "Error de conexión", color: "danger" });
    } finally {
      setCreando(false);
    }
  };

  const revocar = async (id: string) => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api-keys/${id}/revoke`, { method: "POST" });

      if (r.ok) {
        addToast({ title: "Key revocada", color: "success" });
        cargar();
      }
    } catch {
      addToast({ title: "Error de conexión", color: "danger" });
    }
  };

  const borrar = async (id: string) => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api-keys/${id}`, { method: "DELETE" });

      if (r.ok) {
        addToast({ title: "Key borrada", color: "success" });
        cargar();
      }
    } catch {
      addToast({ title: "Error de conexión", color: "danger" });
    }
  };

  const copiar = (t: string) => {
    navigator.clipboard?.writeText(t);
    addToast({ title: "Token copiado", color: "success" });
  };

  return (
    <div className="rounded-xl border border-default-200 p-4">
      <p className="font-semibold">API Keys (otros proyectos)</p>
      <p className="mb-3 text-sm text-default-500">
        Emite claves para que otros proyectos o compañeros usen la API (header{" "}
        <code>x-api-key</code>). El token se muestra una sola vez.
      </p>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          className="sm:max-w-xs"
          label="Nombre del proyecto"
          placeholder="ej. delivery, analitics, app-x"
          size="sm"
          value={label}
          onValueChange={setLabel}
        />
        <Button
          color="primary"
          isLoading={creando}
          size="sm"
          startContent={<Icons.add className="size-4" />}
          onPress={crear}
        >
          Emitir key
        </Button>
      </div>

      {nuevoToken && (
        <div className="mb-3 rounded-lg border-l-4 border-warning bg-warning-50 p-3">
          <p className="mb-2 text-sm font-semibold text-warning-700">
            Copia el token AHORA — no se vuelve a mostrar:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              isReadOnly
              className="font-mono"
              size="sm"
              value={nuevoToken}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              color="warning"
              size="sm"
              startContent={<Icons.copy className="size-4" />}
              variant="flat"
              onPress={() => copiar(nuevoToken)}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {keys.length === 0 && (
          <p className="text-sm text-default-400">Aún no hay keys emitidas.</p>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex flex-col gap-2 rounded-lg border border-default-200 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{k.label}</span>
                <Chip color={k.activo ? "success" : "default"} size="sm" variant="flat">
                  {k.activo ? "activa" : "revocada"}
                </Chip>
                <code className="text-xs text-default-500">{k.prefix}…</code>
              </div>
              <div className="mt-1 text-xs text-default-500">
                Usos: {k.usageCount} · Última:{" "}
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "nunca"}
                {k.lastUsedIp ? ` · IP ${k.lastUsedIp}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {k.activo && (
                <Button color="warning" size="sm" variant="flat" onPress={() => revocar(k.id)}>
                  Revocar
                </Button>
              )}
              <Button
                isIconOnly
                aria-label="Borrar key"
                color="danger"
                size="sm"
                variant="flat"
                onPress={() => borrar(k.id)}
              >
                <Icons.trash className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
