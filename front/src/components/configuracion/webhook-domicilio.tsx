import { Button, Chip, Input, Snippet, Switch, addToast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";

/**
 * El webhook de domicilio, en los dos sentidos.
 *
 * Está aquí y no en un .env porque el día que haya que cambiar la URL o rotar el secret,
 * hacerlo desde una pantalla es un minuto y hacerlo desde el .env es un despliegue —y
 * con la prisa de ese día, un despliegue es cuando se rompe algo.
 *
 * Enseña también cuántos avisos están esperando y cuántos pedidos siguen sin cotizar:
 * sin eso, un webhook mal configurado se nota cuando alguien pregunta por qué ningún
 * pedido tiene precio de domicilio, o sea tarde.
 */
export const WebhookDomicilio = () => {
  const [cfg, setCfg] = useState({ url: "", key: "", secret: "", activo: true, tieneSecret: false });
  const [estado, setEstado] = useState<any>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  // El secret recién generado. Se enseña UNA vez: después ya no se puede recuperar,
  // sólo generar otro.
  const [secretNuevo, setSecretNuevo] = useState("");

  const ok = (t: string, d?: string) => addToast({ title: t, description: d, color: "success" });
  const err = (d: string) => addToast({ title: "Error", description: d, color: "danger" });

  const base = getApiBaseUrl();

  const cargar = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        fetch(`${base}/mantenimiento/webhook/domicilio`).then((r) => r.json()),
        fetch(`${base}/mantenimiento/webhook/domicilio/estado`).then((r) => r.json()),
      ]);
      if (!c.error) {
        setCfg({ url: c.url || "", key: c.key || "", secret: "", activo: c.activo ?? true, tieneSecret: !!c.tieneSecret });
      }
      if (!e.error) setEstado(e);
    } catch {
      /* se reintenta al recargar */
    }
  }, [base]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async () => {
    setCargando("guardar");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/domicilio`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: cfg.url, key: cfg.key, secret: cfg.secret, activo: cfg.activo }),
      });
      const j = await res.json();

      if (!res.ok) throw new Error(j.error || "Error");
      setCfg((c) => ({ ...c, secret: "", tieneSecret: c.tieneSecret || !!cfg.secret }));
      ok("Guardado");
      cargar();
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setCargando(null);
    }
  };

  const generarSecret = async () => {
    setCargando("secret");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/domicilio/secret`, { method: "POST" });
      const j = await res.json();

      if (!res.ok) throw new Error(j.error || "Error");
      setSecretNuevo(j.secret);
      setCfg((c) => ({ ...c, tieneSecret: true, secret: "" }));
      ok("Secret nuevo", "Cópialo ahora: no se vuelve a mostrar.");
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo generar");
    } finally {
      setCargando(null);
    }
  };

  const probar = async () => {
    setCargando("probar");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/domicilio/probar`, { method: "POST" });
      const j = await res.json();

      if (!res.ok) throw new Error(j.error || "No contestó");
      ok("Conectado", `${j.url} respondió en ${j.ms} ms`);
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo probar");
    } finally {
      setCargando(null);
    }
  };

  const reencolar = async () => {
    setCargando("reencolar");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/domicilio/reencolar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();

      if (!res.ok) throw new Error(j.error || "Error");
      ok("Reencolados", `${j.encolados} pedidos vuelven a la cola`);
      cargar();
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo reencolar");
    } finally {
      setCargando(null);
    }
  };

  const urlEntrada = `${base.replace(/\/$/, "")}/webhooks/domicilio`;

  return (
    <div className="rounded-xl border border-default-200 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Webhook Domicilio (APK)</p>
        <Switch
          isSelected={cfg.activo}
          size="sm"
          onValueChange={(v) => setCfg((c) => ({ ...c, activo: v }))}
        >
          Activo
        </Switch>
      </div>
      <p className="mb-3 text-sm text-default-500">
        Cuando un pedido pide domicilio, se le avisa a la APK con el peso, las coordenadas
        del cliente y el total sin domicilio. Ella devuelve el costo por la URL de entrada.
        El mismo secret firma la ida y verifica la vuelta.
      </p>

      {/* SALIDA */}
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            className="min-w-0 flex-1"
            label="URL de la APK (salida)"
            placeholder="https://…/webhooks/pedido"
            size="sm"
            value={cfg.url}
            onValueChange={(v) => setCfg((c) => ({ ...c, url: v }))}
          />
          <Input
            className="w-full sm:w-40"
            label="Key"
            size="sm"
            value={cfg.key}
            onValueChange={(v) => setCfg((c) => ({ ...c, key: v }))}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            className="min-w-0 flex-1"
            label="Secret (compartido)"
            placeholder={cfg.tieneSecret ? "•••• (sin cambios)" : "pega uno o genéralo"}
            size="sm"
            type="password"
            value={cfg.secret}
            onValueChange={(v) => setCfg((c) => ({ ...c, secret: v }))}
          />
          <div className="flex gap-2">
            <Button isLoading={cargando === "secret"} size="sm" variant="flat" onPress={generarSecret}>
              Generar
            </Button>
            <Button color="primary" isLoading={cargando === "guardar"} size="sm" onPress={guardar}>
              Guardar
            </Button>
            <Button isDisabled={!cfg.url} isLoading={cargando === "probar"} size="sm" variant="flat" onPress={probar}>
              Probar
            </Button>
          </div>
        </div>
      </div>

      {secretNuevo && (
        <div className="mb-3 rounded-lg border border-warning-200 bg-warning-50 p-3">
          <p className="mb-2 text-sm font-medium">
            Cópialo y pásaselo al de la APK. No se vuelve a mostrar.
          </p>
          {/* Se envuelve para que un secret de 64 caracteres no estire la tarjeta
              fuera de la pantalla en un teléfono. */}
          <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
            <span className="break-all">{secretNuevo}</span>
          </Snippet>
        </div>
      )}

      {/* ENTRADA */}
      <div className="mb-3">
        <p className="mb-1 text-sm font-medium">URL de entrada (la que ellos llaman)</p>
        <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
          <span className="break-all">{urlEntrada}</span>
        </Snippet>
      </div>

      {/* ESTADO */}
      {estado && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={estado.configurado ? "success" : "warning"} size="sm" variant="flat">
            {estado.configurado ? "Configurado" : "Falta URL o secret"}
          </Chip>
          <Chip size="sm" variant="flat">
            <span className="inline-flex items-center gap-1">
              <Icons.mailOutgoing className="size-3.5" />
              {estado.cola?.waiting ?? 0} en cola
            </span>
          </Chip>
          {(estado.cola?.failed ?? 0) > 0 && (
            <Chip color="danger" size="sm" variant="flat">
              {estado.cola.failed} fallados
            </Chip>
          )}
          <Chip color={estado.sinCotizar > 0 ? "warning" : "default"} size="sm" variant="flat">
            {estado.sinCotizar} sin cotizar
          </Chip>
          {estado.sinGeolocalizar > 0 && (
            <Chip size="sm" variant="flat">
              {estado.sinGeolocalizar} sin geolocalizar
            </Chip>
          )}
          <Button
            isDisabled={!estado.sinCotizar}
            isLoading={cargando === "reencolar"}
            size="sm"
            variant="flat"
            onPress={reencolar}
          >
            Reencolar pendientes
          </Button>
        </div>
      )}
    </div>
  );
};
