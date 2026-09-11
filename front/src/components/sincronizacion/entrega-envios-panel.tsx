import { Button, Card, CardBody, Chip, Spinner } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Qué está intentando meter la APK de Entrega, y por qué no entra.
 *
 * # Por qué existe esta pantalla
 *
 * Esto sólo se veía en el log del contenedor. Para saber por qué una entrega no salía de
 * «pendientes» había que entrar al servidor y leer `docker service logs`, y el log se va a
 * los pocos días. Así que cada vez que se atascaba algo había que reconstruirlo a mano.
 *
 * # Lo que de verdad hay que distinguir
 *
 * Cuando un folio no entra, sólo hay tres causas, y cada una se arregla en un sitio
 * distinto. Confundirlas es lo que ha hecho perder días:
 *
 * - **Todavía no está subido** — el repartidor entrega el mismo día y el pedido llega a
 *   PEDIDO cuando el vendedor sube su archivo. Al principio es normal y se arregla solo.
 *   Si lleva más de un día, es que nadie lo ha subido: eso es nuestro.
 * - **No lleva domicilio** — el pedido existe y se recoge en el almacén. Se rechaza
 *   siempre y reintentar no sirve de nada. Eso es de la APK, que no debería cobrarlo.
 * - **Otra cosa** — folio ambiguo, costo inválido…
 *
 * Por eso cada fila lleva su etiqueta y, al lado, **lo que tenemos nosotros de ese folio**:
 * ver las dos cadenas juntas es lo que deja decidir sin preguntarle a nadie.
 */
const api = getApiBaseUrl;

type Clase = "aplicada" | "no_subido" | "sin_domicilio" | "ambiguo" | "otro";

interface Intento {
  folio: string;
  motivo: string;
  codigo: string;
  ok: boolean;
  clase: Clase;
  intentos: number;
  cliente: string | null;
  vendedorMandado: string | null;
  campos: string | null;
  primeroAt: string;
  ultimoAt: string;
  nuestro: {
    folio: string;
    cliente: string | null;
    fecha: string | null;
    creadoAt: string;
    requiereDomicilio: boolean | null;
    vendedor: string | null;
    sucursal: string | null;
  } | null;
}

interface Respuesta {
  desde: string;
  resumen: {
    folios: number;
    aplicadas: number;
    no_subido: number;
    sin_domicilio: number;
    ambiguo: number;
    otro: number;
    reintentos_en_balde: number;
  };
  intentos: Intento[];
}

/**
 * Etiqueta, color y qué hacer con cada clase.
 *
 * `resumen` es la frase corta que va en la fila. El motivo entero —que puede ser un
 * párrafo con los nombres de veintitrés clientes— va en el detalle que se abre al pulsar:
 * metido en una celda revienta la tabla y obliga a hacer scroll lateral para leer lo demás.
 */
const CLASES: Record<Clase, { texto: string; color: "success" | "warning" | "danger" | "default"; resumen: string; queHacer: string }> = {
  aplicada: {
    texto: "Entró",
    color: "success",
    resumen: "el costo se guardó",
    queHacer: "El costo se guardó",
  },
  no_subido: {
    texto: "No subido",
    color: "warning",
    resumen: "el pedido aún no está en PEDIDO",
    queHacer:
      "El repartidor entrega el mismo día y el pedido entra cuando el vendedor sube su archivo. Si lleva más de un día, no lo ha subido nadie: eso es nuestro",
  },
  sin_domicilio: {
    texto: "No lleva domicilio",
    color: "danger",
    resumen: "ese pedido se recoge en el almacén",
    queHacer:
      "La APK no debería cobrarlo y reintentar no sirve de nada. Se evita sincronizando /integration/orders?soloDomicilio=1 en el móvil",
  },
  ambiguo: {
    texto: "Falta el cliente",
    color: "warning",
    resumen: "ese folio tiene varios clientes debajo",
    queHacer:
      "Entra en cuanto la APK mande clienteId. El folio lo pone Parranda y trae varios clientes; nosotros le ponemos sufijo para separarlos",
  },
  otro: { texto: "Otro", color: "default", resumen: "ver el detalle", queHacer: "Mirar el motivo" },
};

function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;

  return `hace ${Math.round(min / 1440)} días`;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);

  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function EntregaEnviosPanel() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Clase | "todo">("todo");
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await fetch(`${api()}/entrega/intentos`).then((r) => r.json()));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // Se refresca sola: la APK reintenta cada minuto y esta pantalla se mira mientras se
    // arregla algo, así que quedarse congelada engaña.
    const t = setInterval(cargar, 60_000);

    return () => clearInterval(t);
  }, [cargar]);

  if (cargando && !datos) return <Spinner label="Cargando lo que manda Entrega…" />;
  if (!datos) return null;

  const r = datos.resumen;
  const filas = filtro === "todo" ? datos.intentos : datos.intentos.filter((i) => i.clase === filtro);

  const tarjetas: Array<{ clase: Clase | "todo"; titulo: string; valor: number; pie: string }> = [
    { clase: "todo", titulo: "Folios", valor: r.folios, pie: "en 7 días" },
    { clase: "sin_domicilio", titulo: "Sin domicilio", valor: r.sin_domicilio, pie: "de la APK" },
    { clase: "no_subido", titulo: "Sin subir", valor: r.no_subido, pie: "nuestro" },
    { clase: "ambiguo", titulo: "Falta cliente", valor: r.ambiguo ?? 0, pie: "de la APK" },
    { clase: "aplicada", titulo: "Entraron", valor: r.aplicadas, pie: "con su costo" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tarjetas.map((t) => (
          <Card
            key={t.titulo}
            isPressable
            className={filtro === t.clase ? "ring-2 ring-primary" : ""}
            onPress={() => setFiltro(t.clase)}
          >
            <CardBody className="py-3">
              <p className="text-xs uppercase tracking-wide text-default-500">{t.titulo}</p>
              <p className="text-2xl font-semibold tabular-nums">{t.valor}</p>
              <p className="text-xs text-default-400">{t.pie}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* El número que duele: cuántas veces se ha reintentado algo que nunca va a entrar. */}
      {r.reintentos_en_balde > 0 && (
        <Card>
          <CardBody className="py-3 flex-row items-center justify-between gap-3 flex-wrap">
            <span className="text-sm">
              <strong className="tabular-nums">{r.reintentos_en_balde.toLocaleString("es")}</strong>{" "}
              reintentos que no han entrado. La APK repite cada minuto y no para sola.
            </span>
            <Button size="sm" variant="flat" onPress={cargar}>
              Actualizar
            </Button>
          </CardBody>
        </Card>
      )}

      {filtro !== "todo" && (
        <p className="text-sm text-default-600">
          {CLASES[filtro].queHacer}.{" "}
          <button className="underline" type="button" onClick={() => setFiltro("todo")}>
            Ver todo
          </button>
        </p>
      )}

      {/* UNA FILA POR FOLIO, Y EL DETALLE DEBAJO.

          Antes era una tabla de siete columnas con el motivo entero dentro de una celda.
          Un motivo puede ser un párrafo con los nombres de veintitrés clientes, así que la
          fila crecía hasta ocupar la pantalla y había que hacer scroll lateral para leer
          las otras columnas. Aquí la fila cabe en una línea y lo largo se abre al pulsar.

          Sin `<table>` a propósito: con contenido de anchos tan distintos —un folio corto y
          un párrafo— la tabla reparte mal el ancho y se rompe en cuanto se estrecha. */}
      <div className="flex flex-col gap-2">
        {filas.length === 0 && (
          <p className="text-sm text-default-500">No ha llegado nada de Entrega en los últimos 7 días.</p>
        )}
        {filas.map((i) => {
          const clave = `${i.folio}|${i.codigo}`;
          const esta = abierto === clave;
          const c = CLASES[i.clase];

          return (
            <Card key={clave} isPressable className="w-full" onPress={() => setAbierto(esta ? null : clave)}>
              <CardBody className="gap-2 py-3">
                {/* La línea de siempre: folio, qué pasa, cuántas veces y cuándo. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-sm">{i.folio}</span>
                  <Chip color={c.color} size="sm" variant="flat">
                    {c.texto}
                  </Chip>
                  <span className="text-xs text-default-500">{c.resumen}</span>
                  <span className="ml-auto text-xs text-default-500">
                    <strong className="tabular-nums">{i.intentos.toLocaleString("es")}</strong> intentos ·{" "}
                    {haceCuanto(i.ultimoAt)}
                  </span>
                </div>

                {/* Lo nuestro, en una línea. Si no hay pedido se dice y ya. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500">
                  {i.nuestro ? (
                    <>
                      <span className="font-mono">{i.nuestro.folio}</span>
                      <span>{i.nuestro.cliente ?? "—"}</span>
                      <span>
                        {i.nuestro.vendedor ?? "—"}
                        {i.nuestro.sucursal ? ` · ${i.nuestro.sucursal}` : ""}
                      </span>
                    </>
                  ) : (
                    <span>no está en PEDIDO</span>
                  )}
                  {/* Lo que NO mandan, que es la mitad del diagnóstico. */}
                  {i.cliente === "(no mandaron cliente)" && <span className="text-warning-600">sin cliente</span>}
                  {i.vendedorMandado === "(no mandaron vendedor)" && (
                    <span className="text-warning-600">sin vendedor</span>
                  )}
                  <span className="ml-auto underline">{esta ? "menos" : "ver detalle"}</span>
                </div>

                {esta && (
                  <div className="mt-1 flex flex-col gap-2 rounded-medium bg-default-100 p-3 text-xs">
                    <div>
                      <p className="font-medium text-default-700">Lo que contestamos</p>
                      <p className="text-default-600">{i.motivo || "Entró bien."}</p>
                    </div>
                    <div>
                      <p className="font-medium text-default-700">Qué hacer</p>
                      <p className="text-default-600">{c.queHacer}.</p>
                    </div>
                    <div>
                      <p className="font-medium text-default-700">Campos que llegan</p>
                      {/* Los nombres del JSON, tal cual. Es lo que acaba con la discusión
                          de qué manda la APK: si un campo no está aquí, no lo manda. */}
                      <p className="font-mono text-default-600">{i.campos ?? "—"}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-default-500">
                      <span>Cliente que manda: {i.cliente ?? "—"}</span>
                      <span>Vendedor que manda: {i.vendedorMandado ?? "—"}</span>
                      {i.nuestro && (
                        <>
                          <span>Pedido del {fechaCorta(i.nuestro.fecha)}</span>
                          <span>Subido el {fechaCorta(i.nuestro.creadoAt)}</span>
                        </>
                      )}
                      <span>Primer intento {haceCuanto(i.primeroAt)}</span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
