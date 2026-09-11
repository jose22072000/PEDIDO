import { Button, Card, CardBody, Chip, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
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

type Clase = "aplicada" | "no_subido" | "sin_domicilio" | "otro";

interface Intento {
  folio: string;
  motivo: string;
  ok: boolean;
  clase: Clase;
  intentos: number;
  cliente: string | null;
  primeroAt: string;
  ultimoAt: string;
  nuestro: {
    folio: string;
    cliente: string | null;
    fecha: string | null;
    creadoAt: string;
    requiereDomicilio: boolean | null;
  } | null;
}

interface Respuesta {
  desde: string;
  resumen: {
    folios: number;
    aplicadas: number;
    no_subido: number;
    sin_domicilio: number;
    otro: number;
    reintentos_en_balde: number;
  };
  intentos: Intento[];
}

/** Etiqueta, color y —lo importante— qué hacer con cada clase. */
const CLASES: Record<Clase, { texto: string; color: "success" | "warning" | "danger" | "default"; queHacer: string }> = {
  aplicada: { texto: "Entró", color: "success", queHacer: "El costo se guardó" },
  no_subido: {
    texto: "No subido",
    color: "warning",
    queHacer: "El pedido no está en PEDIDO. Entra solo cuando el vendedor suba su archivo; si lleva más de un día, no lo ha subido nadie",
  },
  sin_domicilio: {
    texto: "No lleva domicilio",
    color: "danger",
    queHacer: "El pedido se recoge en el almacén. La APK no debería cobrarlo, y reintentar no sirve de nada",
  },
  otro: { texto: "Otro", color: "default", queHacer: "Mirar el motivo" },
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
    // Se refresca solo: la APK reintenta cada minuto y esta pantalla se mira mientras se
    // arregla algo, así que quedarse congelada engaña.
    const t = setInterval(cargar, 60_000);

    return () => clearInterval(t);
  }, [cargar]);

  if (cargando && !datos) return <Spinner label="Cargando lo que manda Entrega…" />;
  if (!datos) return null;

  const r = datos.resumen;
  const filas = filtro === "todo" ? datos.intentos : datos.intentos.filter((i) => i.clase === filtro);

  const tarjetas: Array<{ clase: Clase | "todo"; titulo: string; valor: number; pie: string }> = [
    { clase: "todo", titulo: "Folios distintos", valor: r.folios, pie: "en los últimos 7 días" },
    { clase: "sin_domicilio", titulo: "No llevan domicilio", valor: r.sin_domicilio, pie: "de la APK: no debería mandarlos" },
    { clase: "no_subido", titulo: "Sin subir a PEDIDO", valor: r.no_subido, pie: "nuestro: falta subir el archivo" },
    { clase: "aplicada", titulo: "Entraron", valor: r.aplicadas, pie: "con su costo guardado" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          <CardBody className="py-3 flex-row items-baseline justify-between gap-3">
            <span className="text-sm">
              <strong className="tabular-nums">{r.reintentos_en_balde.toLocaleString("es")}</strong> reintentos
              que no han entrado. La APK repite cada minuto y no para sola.
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

      <Table aria-label="Lo que manda la APK de Entrega">
        <TableHeader>
          <TableColumn>FOLIO QUE MANDA LA APK</TableColumn>
          <TableColumn>QUÉ PASA</TableColumn>
          <TableColumn>LO QUE TENEMOS NOSOTROS</TableColumn>
          <TableColumn>CLIENTE QUE MANDA</TableColumn>
          <TableColumn>INTENTOS</TableColumn>
          <TableColumn>DESDE / ÚLTIMO</TableColumn>
        </TableHeader>
        <TableBody emptyContent="No ha llegado nada de Entrega en los últimos 7 días.">
          {filas.map((i) => (
            <TableRow key={`${i.folio}|${i.motivo}`}>
              <TableCell className="font-mono text-xs">{i.folio}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Chip color={CLASES[i.clase].color} size="sm" variant="flat">
                    {CLASES[i.clase].texto}
                  </Chip>
                  {i.motivo && <span className="text-xs text-default-500">{i.motivo}</span>}
                </div>
              </TableCell>
              <TableCell>
                {i.nuestro ? (
                  <div className="flex flex-col">
                    {/* Si las dos cadenas no son iguales, es que le pusimos sufijo: verlo
                        aquí es lo que evita la discusión de «ese folio no existe». */}
                    <span className="font-mono text-xs">{i.nuestro.folio}</span>
                    <span className="text-xs text-default-500">
                      {i.nuestro.cliente ?? "—"} · pedido del {fechaCorta(i.nuestro.fecha)} · subido el{" "}
                      {fechaCorta(i.nuestro.creadoAt)}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-default-400">no está en PEDIDO</span>
                )}
              </TableCell>
              <TableCell className="text-xs">{i.cliente ?? "—"}</TableCell>
              <TableCell className="tabular-nums">{i.intentos.toLocaleString("es")}</TableCell>
              <TableCell className="text-xs text-default-500">
                {haceCuanto(i.primeroAt)}
                <br />
                {haceCuanto(i.ultimoAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
