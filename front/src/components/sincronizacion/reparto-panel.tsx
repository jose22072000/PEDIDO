import { Button, Card, CardBody, CardHeader, Chip, Input, Snippet, Spinner, Switch, addToast } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Las DOS direcciones entre PEDIDO y el reparto: configurarlas y ver si están vivas.
 *
 * Hasta ahora esto no se veía en ninguna parte: el reparto preguntaba cada minuto y
 * nadie sabía si llegaba o no. Ahora PEDIDO avisa —deja el aviso en una cola— y el
 * reparto escribe de vuelta los estados de la entrega.
 *
 * Lo que se enseña aquí NO es sólo «está configurado», que eso no dice nada: un
 * sincronizado parado tiene la casilla de «activo» igual de verde que uno que va bien.
 * Se enseña si está PASANDO algo —cuántos avisos esperan, cuántos cogió el reparto y no
 * terminó, cuánto hace del último— y, debajo, QUÉ se está mandando, aviso por aviso.
 */
type Estado = {
  enviar: {
    encendido: boolean;
    porDefecto: boolean;
    stream: string;
    redis: boolean;
    hay: number | null;
    sinTerminar: number | null;
    ultimoAviso: number | null;
    grupoCreado: boolean;
    regla: string;
    motivos: { motivo: string; que: string }[];
    webhook: {
      url: string;
      key: string;
      tieneSecret: boolean;
      activo: boolean;
      esperando: number | null;
      fallados: number | null;
    };
  };
  recibir: {
    por: string;
    formato: string;
    claves: { id: string; label: string; prefix: string; usada: string | null; veces: number }[];
    recibidosHoy: number;
    ultimo: { folio: string; estado: string | null; cuando: string; sucursalId: string | null } | null;
  };
};

type Aviso = {
  _id: string;
  entidad?: string;
  motivo?: string;
  accion?: string;
  id?: string;
  sucursalId?: string;
  ts?: string;
};

const POR_PAGINA = 25;

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

/** El `ts` del aviso viene como texto porque en un stream de Redis todo es texto. */
const cuandoMs = (ts: string | undefined) => cuando(ts ? new Date(Number(ts)).toISOString() : null);

const colorMotivo = (m: string | undefined) =>
  m === "borrado" ? ("danger" as const) : m === "factura" ? ("primary" as const) : ("default" as const);

export const RepartoSyncPanel = () => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Los avisos se acumulan página a página. El cursor es el id del último visto, no un
  // número de página: entran avisos por arriba todo el rato y la «página 2» de hace un
  // minuto ya no es la misma.
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargandoAvisos, setCargandoAvisos] = useState(false);

  // El formulario del webhook. Separado de `estado` a propósito: `estado` se recarga
  // solo cada 30 s, y si de paso reescribiera el formulario, un refresco mientras se
  // teclea la URL la borraría de debajo de las manos.
  const [form, setForm] = useState({ url: "", key: "", secret: "" });
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // El secret recién generado. Se enseña UNA vez: después ya no se recupera, sólo se
  // genera otro — y generar otro deja al otro extremo fuera hasta que se lo pasen.
  const [secretNuevo, setSecretNuevo] = useState("");

  const base = getApiBaseUrl();
  const cabeceras = () => ({ Authorization: `Bearer ${localStorage.getItem("auth_token")}` });

  // El refresco de cada 30 s vive en un intervalo que se creó una vez, así que leer
  // `tocado` directamente le daría siempre el valor del montaje. La ref ve el de ahora.
  const tocadoRef = useRef(false);

  useEffect(() => {
    tocadoRef.current = tocado;
  }, [tocado]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${base}/sincronizacion/reparto`, { headers: cabeceras() });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo leer el estado");
      setEstado(data);
      // Sólo mientras nadie haya escrito: después manda lo que tiene delante.
      setForm((f) => (tocadoRef.current ? f : { url: data.enviar?.webhook?.url || "", key: data.enviar?.webhook?.key || "", secret: "" }));
    } catch (e) {
      addToast({
        title: "No se pudo leer la sincronización",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, [base]);

  /** `antes` sin valor = empezar de cero; con valor = añadir la página siguiente. */
  const cargarAvisos = useCallback(
    async (antes?: string) => {
      setCargandoAvisos(true);
      try {
        const q = new URLSearchParams({ limite: String(POR_PAGINA) });

        if (antes) q.set("antes", antes);
        const res = await fetch(`${base}/sincronizacion/reparto/avisos?${q}`, { headers: cabeceras() });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "No se pudieron leer los avisos");
        setAvisos((previos) => (antes ? [...previos, ...data.avisos] : data.avisos));
        setSiguiente(data.siguiente);
      } catch (e) {
        addToast({
          title: "No se pudieron leer los avisos",
          description: e instanceof Error ? e.message : "Error desconocido",
          color: "danger",
        });
      } finally {
        setCargandoAvisos(false);
      }
    },
    [base],
  );

  // Se refresca solo: es una pantalla para mirar mientras pasa algo. Los avisos NO se
  // refrescan con el reloj a propósito: si se está leyendo la lista con tres páginas
  // abiertas, recargarla sola por debajo es perder el sitio.
  useEffect(() => {
    void cargar();
    void cargarAvisos();
    const t = setInterval(() => void cargar(), 30_000);

    return () => clearInterval(t);
  }, [cargar, cargarAvisos]);

  const cambiarInterruptor = async (activo: boolean) => {
    setGuardando(true);
    // Se pinta ya: si el servidor dice que no, se deshace al recargar.
    setEstado((e) => (e ? { ...e, enviar: { ...e.enviar, encendido: activo } } : e));
    try {
      const res = await fetch(`${base}/sincronizacion/reparto`, {
        method: "PUT",
        headers: { ...cabeceras(), "content-type": "application/json" },
        body: JSON.stringify({ activo }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      addToast({
        title: activo ? "Avisos encendidos" : "Avisos apagados",
        description: activo
          ? "PEDIDO vuelve a dejar avisos en la cola del reparto."
          : "PEDIDO deja de avisar. Los cambios de estos minutos NO se recuperan al encenderlo.",
        color: activo ? "success" : "warning",
      });
    } catch (e) {
      addToast({
        title: "No se pudo guardar",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setGuardando(false);
      void cargar();
    }
  };

  /**
   * Guardar, generar el secret y probar. Van contra `/mantenimiento/webhook/reparto`,
   * que es el MISMO sitio donde se configura el webhook de la APK: un solo formulario
   * para los dos, y así no hay dos maneras de hacer lo mismo con distinto aspecto.
   *
   * Esas rutas son sólo del Super Admin, a propósito: esto es una URL a la que le
   * mandamos pedidos con datos de clientes, y un secret que firma lo que sale.
   */
  const guardar = async () => {
    setOcupado("guardar");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/reparto`, {
        method: "PUT",
        headers: { ...cabeceras(), "content-type": "application/json" },
        body: JSON.stringify({ url: form.url, key: form.key, secret: form.secret, activo: true }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      // El secret ya viajó: no se queda escrito en la pantalla de nadie.
      setForm((f) => ({ ...f, secret: "" }));
      setTocado(false);
      addToast({ title: "Guardado", color: "success" });
      void cargar();
    } catch (e) {
      addToast({
        title: "No se pudo guardar",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setOcupado(null);
    }
  };

  const generarSecret = async () => {
    setOcupado("secret");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/reparto/secret`, {
        method: "POST",
        headers: cabeceras(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo generar");
      setSecretNuevo(data.secret);
      addToast({
        title: "Secret nuevo",
        description: "Cópialo ahora: no se vuelve a mostrar, y hasta que el reparto lo tenga, lo que salga no le cuadra.",
        color: "warning",
      });
      void cargar();
    } catch (e) {
      addToast({
        title: "No se pudo generar",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setOcupado(null);
    }
  };

  const probar = async () => {
    setOcupado("probar");
    try {
      const res = await fetch(`${base}/mantenimiento/webhook/reparto/probar`, {
        method: "POST",
        headers: cabeceras(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Contestó ${res.status}`);
      addToast({
        title: "Llegó",
        description: `${data.ms} ms${data.firmado ? ", firmado" : ", SIN firmar (falta el secret)"}`,
        color: "success",
      });
    } catch (e) {
      addToast({
        title: "No llegó",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setOcupado(null);
    }
  };

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
    <div className="flex flex-col gap-4">
      {/* --------------------------------------------------- CONFIGURACIÓN */}
      <div className="rounded-xl border border-default-200 p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Sincronización con el Reparto</p>
          <Switch
            isDisabled={guardando}
            isSelected={enviar.encendido}
            size="sm"
            onValueChange={(v) => void cambiarInterruptor(v)}
          >
            Activo
          </Switch>
        </div>
        <p className="mb-3 text-sm text-default-500">
          El interruptor está aquí y no en un .env porque cambiarlo desde una pantalla es
          un minuto y desde el .env es un despliegue. Apagado, PEDIDO deja de avisar y
          esos cambios <span className="font-medium">no se recuperan</span> al volver a
          encenderlo: el reparto los verá en su siguiente repaso de los días atrás.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-sm font-medium">Cola de salida (la que lee el reparto)</p>
            <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
              <span className="break-all">{enviar.stream}</span>
            </Snippet>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-sm font-medium">Entrada de vuelta (la que llama el reparto)</p>
            <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
              <span className="break-all">{recibir.por}</span>
            </Snippet>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip color={salud.color} size="sm" variant="flat">
            {salud.texto}
          </Chip>
          <Chip size="sm" variant="flat">
            Por defecto: {enviar.porDefecto ? "encendido" : "apagado"}
          </Chip>
          <span className="text-[11px] text-default-400">
            Mientras nadie toque el interruptor, manda el valor por defecto del entorno.
          </span>
        </div>
      </div>

      {/* ------------------------------------------- EL WEBHOOK: URL, KEY Y SECRET */}
      <div className="rounded-xl border border-default-200 p-4">
        <p className="mb-1 font-semibold">Webhook de salida (opcional)</p>
        <p className="mb-3 text-sm text-default-500">
          La otra puerta, para quien prefiera que le toquen antes que leer la cola. Le
          llega el aviso <span className="font-medium">con el pedido entero dentro</span>
          {" "}—cliente con coordenadas, vendedor y líneas con sus pesos— así que no tiene
          que volver a preguntar. Sale firmado y con reintentos.
          <span className="mt-1 block">
            <span className="font-medium">Sin URL no sale ni un POST</span>, y eso es lo
            que hay hoy: el reparto lee la cola. La cola espera; un webhook se rinde a los
            tres intentos. No conviene tener las dos a la vez.
          </span>
        </p>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            label="URL del reparto"
            placeholder="https://…/webhooks/pedido"
            size="sm"
            value={form.url}
            onValueChange={(v) => {
              setTocado(true);
              setForm((f) => ({ ...f, url: v }));
            }}
          />
          <Input
            label="Key (viaja en X-Webhook-Key)"
            placeholder="la que te dé el reparto"
            size="sm"
            value={form.key}
            onValueChange={(v) => {
              setTocado(true);
              setForm((f) => ({ ...f, key: v }));
            }}
          />
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            className="min-w-0 flex-1"
            label="Secret (el mismo en los dos lados)"
            placeholder={enviar.webhook.tieneSecret ? "•••• (sin cambios)" : "pega uno o genéralo"}
            size="sm"
            type="password"
            value={form.secret}
            onValueChange={(v) => {
              setTocado(true);
              setForm((f) => ({ ...f, secret: v }));
            }}
          />
          <div className="flex gap-2">
            <Button isLoading={ocupado === "secret"} size="sm" variant="bordered" onPress={() => void generarSecret()}>
              Generar
            </Button>
            <Button
              isDisabled={!enviar.webhook.url}
              isLoading={ocupado === "probar"}
              size="sm"
              variant="bordered"
              onPress={() => void probar()}
            >
              Probar
            </Button>
            <Button color="primary" isLoading={ocupado === "guardar"} size="sm" onPress={() => void guardar()}>
              Guardar
            </Button>
          </div>
        </div>

        {secretNuevo && (
          <div className="mb-3 rounded-lg border border-warning-200 bg-warning-50 p-3">
            <p className="mb-2 text-sm font-medium">
              Cópialo y pásaselo al del reparto. No se vuelve a mostrar, y hasta que lo
              tenga, lo que salga no le va a cuadrar.
            </p>
            <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
              <span className="break-all">{secretNuevo}</span>
            </Snippet>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Chip color={enviar.webhook.url ? "success" : "default"} size="sm" variant="flat">
            {enviar.webhook.url
              ? enviar.webhook.tieneSecret
                ? "Configurado"
                : "Falta el secret"
              : "Sin usar (sólo cola)"}
          </Chip>
          {enviar.webhook.esperando != null && (
            <Chip size="sm" variant="flat">
              {enviar.webhook.esperando} esperando salir
            </Chip>
          )}
          {(enviar.webhook.fallados ?? 0) > 0 && (
            <Chip color="danger" size="sm" variant="flat">
              {enviar.webhook.fallados} fallados
            </Chip>
          )}
        </div>
      </div>

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
              <p className="text-xs font-semibold text-default-600">{enviar.regla}</p>
              <p className="mb-2 mt-2 text-xs font-semibold text-default-600">Se avisa cuando…</p>
              <ul className="flex flex-col gap-1">
                {enviar.motivos.map((m) => (
                  <li key={m.motivo} className="text-xs text-default-600">
                    <span className="font-mono text-[11px] text-primary">{m.motivo}</span> — {m.que}
                  </li>
                ))}
              </ul>
            </div>

            {!enviar.grupoCreado && enviar.encendido && (
              <p className="text-[11px] text-warning">
                El reparto todavía no ha creado su grupo de lectura: los avisos se acumulan
                esperándolo.
              </p>
            )}
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

          <div>
            <p className="mb-1 text-xs font-medium text-default-600">Entra por</p>
            <Snippet hideSymbol className="max-w-full" size="sm" variant="bordered">
              <span className="break-all">{recibir.por}</span>
            </Snippet>
            <p className="mt-1 font-mono text-[11px] text-default-400">{recibir.formato}</p>
          </div>

          {/*
            QUIÉN puede escribirnos, y si lo está usando.
            Una clave que nadie ha usado nunca y una que se usó hace un minuto se ven
            igual en una lista de claves, y son cosas muy distintas: la primera es o una
            clave que el otro extremo no tiene, o una que sobra y hay que revocar.
          */}
          {recibir.claves.length > 0 && (
            <div className="rounded-medium bg-default-100 p-3">
              <p className="mb-2 text-xs font-semibold text-default-600">Quién puede escribir aquí</p>
              <ul className="flex flex-col gap-1">
                {recibir.claves.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="text-default-600">
                      {k.label} <span className="font-mono text-[11px] text-default-400">{k.prefix}…</span>
                    </span>
                    <span className={k.usada ? "text-default-500" : "text-warning"}>
                      {k.usada ? `usada ${hace(new Date(k.usada).getTime())}` : "nunca usada"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-default-400">
            Esta dirección no tiene interruptor: si la clave está mal, el reparto recibe un
            401 y se ve en su propio registro. Hay además una puerta firmada,{" "}
            <span className="font-mono">POST /webhooks/reparto/estados</span>, con la
            misma pareja de key y secret de arriba: la clave dice quién eres y la firma
            dice que el cuerpo es el que mandaste.
          </p>
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------------------------- LOS AVISOS, UNO A UNO */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-base font-semibold">Lo que se ha mandado</p>
            <p className="text-xs text-default-500">
              Del más nuevo al más viejo. Aquí se ve si lo que sale es lo que tenía que
              salir, y no sólo cuántos hay.
            </p>
          </div>
          <Button
            isDisabled={cargandoAvisos}
            size="sm"
            variant="bordered"
            onPress={() => void cargarAvisos()}
          >
            Actualizar
          </Button>
        </CardHeader>
        <CardBody className="gap-3">
          {avisos.length === 0 && !cargandoAvisos && (
            <p className="py-6 text-center text-sm text-default-400">
              {enviar.redis
                ? "Todavía no hay ningún aviso en la cola."
                : "No se puede leer la cola: no hay Redis."}
            </p>
          )}

          {avisos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-default-400">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Cuándo</th>
                    <th className="pb-2 pr-3 font-medium">Motivo</th>
                    <th className="pb-2 pr-3 font-medium">Pedido</th>
                    <th className="pb-2 pr-3 font-medium">Sucursal</th>
                    <th className="pb-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {avisos.map((a) => (
                    <tr key={a._id} className="border-t border-default-100">
                      <td className="py-2 pr-3 whitespace-nowrap text-default-500">{cuandoMs(a.ts)}</td>
                      <td className="py-2 pr-3">
                        <Chip color={colorMotivo(a.motivo)} size="sm" variant="flat">
                          {a.motivo || "—"}
                        </Chip>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-primary">{a.id || "—"}</td>
                      <td className="py-2 pr-3 text-default-600">{a.sucursalId || "—"}</td>
                      <td className="py-2 text-default-600">{a.accion || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-default-400">
              {avisos.length > 0 && `${avisos.length} aviso${avisos.length === 1 ? "" : "s"} a la vista`}
            </p>
            {siguiente && (
              <Button
                isLoading={cargandoAvisos}
                size="sm"
                variant="bordered"
                onPress={() => void cargarAvisos(siguiente)}
              >
                Ver más
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <p className="text-center text-[11px] text-default-400">
        Los contadores se actualizan solos cada 30 segundos. La lista, con «Actualizar»:
        así no se mueve de debajo mientras se lee.
      </p>
    </div>
  );
};
