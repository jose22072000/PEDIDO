import { Button, Chip, Input, Snippet, Switch, addToast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";
import { useLiveEvents } from "@/hooks/use-live-events";

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

  // SOLO los contadores. Separado de la config a propósito: esto se refresca cuando
  // sale un aviso, y si de paso reescribiera el formulario, un aviso que llega mientras
  // escribes la URL te borraría lo escrito de debajo de las manos.
  const cargarEstado = useCallback(async () => {
    try {
      const e = await fetch(`${base}/mantenimiento/webhook/domicilio/estado`).then((r) => r.json());
      if (!e.error) setEstado(e);
    } catch {
      /* se reintenta al siguiente evento */
    }
  }, [base]);

  const cargar = useCallback(async () => {
    try {
      const c = await fetch(`${base}/mantenimiento/webhook/domicilio`).then((r) => r.json());
      if (!c.error) {
        setCfg({ url: c.url || "", key: c.key || "", secret: "", activo: c.activo ?? true, tieneSecret: !!c.tieneSecret });
      }
    } catch {
      /* se reintenta al recargar */
    }
    await cargarEstado();
  }, [base, cargarEstado]);

  useEffect(() => {
    cargar();
    // Sólo al montar: si dependiera de `cargar`, cualquier render que la recree
    // volvería a pisar el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EN VIVO por SSE: nada de preguntar cada X segundos. El worker publica en el mismo
  // Redis que lee el stream de la API, así que la pantalla se entera en cuanto sale un
  // aviso. Refresca SÓLO los contadores —no la página, no el formulario— y el worker
  // limita cuántos eventos emite, así que un relleno de 700 no dispara 700 refrescos.
  useLiveEvents(["webhook"], () => {
    void cargarEstado();
  });

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
        delivery-apk manda a PEDIDO el folio con el costo del domicilio, la distancia y,
        si el repartidor la corrigió, la ubicación del cliente. PEDIDO lo guarda y le
        contesta qué hizo con cada uno. El secret firma el envío y PEDIDO lo verifica.
      </p>

      {/*
        Aquí había una "URL de la APK (salida)": PEDIDO le avisaba de cada pedido.
        Se quitó porque no hacía falta. En delivery-apk el repartidor teclea el número
        de pedido y elige al cliente de la lista que ya tiene bajada, así que cuando
        llega el pedido ya lo tiene delante: avisarle era contarle algo que ya sabía.
      */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          className="min-w-0 flex-1"
          label="Secret (el mismo en delivery-apk)"
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
        </div>
      </div>

      {secretNuevo && (
        <div className="mb-3 rounded-lg border border-warning-200 bg-warning-50 p-3">
          <p className="mb-2 text-sm font-medium">
            Cópialo y pásaselo al de delivery-apk. No se vuelve a mostrar.
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
        <p className="mb-1 text-sm font-medium">
          URL de entrada (la que llama delivery-apk)
        </p>
        <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
          <span className="break-all">{urlEntrada}</span>
        </Snippet>
      </div>

      {/* ESTADO */}
      {estado && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={estado.configurado ? "success" : "warning"} size="sm" variant="flat">
            {estado.configurado ? "Configurado" : "Falta el secret"}
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
        </div>
      )}
    </div>
  );
};
