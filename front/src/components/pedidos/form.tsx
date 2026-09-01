import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  Progress,
  addToast,
} from "@heroui/react";
// import { Calendar } from "@heroui/react";
import { useState } from "react";
import { FileUploader } from "react-drag-drop-files";
import Papa from "papaparse";

import Icons from "../icons/iconify";
import { getApiBaseUrl } from "@/config";

const fileTypes: string[] = ["CSV"];

// Cuando la cola de importación está activa (IMPORT_USE_QUEUE=true), POST /orders/bulk
// responde 202 { jobId } y el worker procesa aparte. Seguimos el resultado por SSE
// (push del worker vía Redis) — NADA de polling. Abrimos UN stream y esperamos el
// evento done/failed de cada jobId. `buffered` cubre la carrera de que el evento
// llegue antes de que empecemos a esperarlo.
/** Pregunta al servidor como acabo un trabajo de importacion. */
async function preguntarEstado(
  jobId: string,
): Promise<{ estado: string; error?: string }> {
  const r = await fetch(`${getApiBaseUrl()}/orders/import-status/${encodeURIComponent(jobId)}`);

  if (!r.ok) throw new Error("No se pudo consultar el estado");

  return r.json();
}

async function openImportStream() {
  // Auth por TICKET efímero (no token en la URL): pedimos el ticket con el Bearer normal
  // (el wrapper de fetch en main.tsx añade Authorization + x-sucursal-id) y abrimos el
  // SSE con ?ticket=. El backend valida/quema el ticket y aísla los eventos por sucursal.
  const ticketRes = await fetch(`${getApiBaseUrl()}/orders/sse-ticket`, {
    method: "POST",
  });

  if (!ticketRes.ok) throw new Error("No se pudo abrir el canal de importación");
  const { ticket } = await ticketRes.json();

  const es = new EventSource(
    `${getApiBaseUrl()}/orders/import-stream?ticket=${encodeURIComponent(ticket)}`,
  );
  const waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  const buffered = new Map<string, { ok: boolean; error?: string }>();

  const settle = (jobId: string, ok: boolean, error?: string) => {
    const w = waiters.get(jobId);

    if (w) {
      waiters.delete(jobId);
      if (ok) w.resolve();
      else w.reject(new Error(error || "Falló la importación"));
    } else {
      buffered.set(jobId, { ok, error });
    }
  };

  es.addEventListener("done", (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data);

      settle(String(d.jobId), true);
    } catch {
      /* ignore */
    }
  });
  es.addEventListener("failed", (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data);

      settle(String(d.jobId), false, d.error);
    } catch {
      /* ignore */
    }
  });

  // Se espera al evento `ready` ANTES de devolver el canal. Crear el EventSource no
  // significa estar suscrito: el navegador todavia tiene que hacer la peticion y el
  // servidor engancharse a Redis. Si mientras tanto se manda el CSV y la importacion
  // es rapida, el `done` se publica cuando aun no hay nadie escuchando y se pierde
  // para siempre -> la pantalla se queda girando hasta agotar el tope de 5 minutos.
  //
  // En local no se veia porque la ida y vuelta es de microsegundos; con un enlace
  // lento (Starlink, una sucursal con mala antena) el orden se invierte casi siempre.
  // De ahi que fallara justo a quien peor conexion tiene.
  await new Promise<void>((resolve, reject) => {
    const listo = setTimeout(
      () => reject(new Error("No se pudo abrir el canal de importación (sin respuesta)")),
      20000,
    );

    es.addEventListener(
      "ready",
      () => {
        clearTimeout(listo);
        resolve();
      },
      { once: true },
    );
    es.addEventListener("error", () => {
      // EventSource reintenta solo; solo se corta si aun no habia conectado nunca.
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(listo);
        reject(new Error("No se pudo abrir el canal de importación"));
      }
    });
  });

  return {
    wait: (jobId: string, fileName: string) =>
      new Promise<void>((resolve, reject) => {
        const b = buffered.get(jobId);

        if (b) {
          buffered.delete(jobId);
          if (b.ok) resolve();
          else reject(new Error(b.error || `Falló la importación de ${fileName}`));

          return;
        }
        // Red de seguridad: si el aviso no llega (canal caído, microcorte), NO se
        // da por fallida la importación sin más. Se PREGUNTA por el estado real
        // del trabajo antes de decir nada.
        //
        // Dar por fallido algo que terminó bien es el peor de los errores
        // posibles aquí: el usuario lo repite y sube los pedidos dos veces.
        const timer = setTimeout(() => {
          waiters.delete(jobId);
          preguntarEstado(jobId)
            .then((r) => {
              if (r.estado === "completed" || r.estado === "desconocido") resolve();
              else if (r.estado === "failed")
                reject(new Error(r.error || `Falló la importación de ${fileName}`));
              else
                reject(
                  new Error(
                    `La importación de ${fileName} sigue en curso (${r.estado}). ` +
                      `Se está procesando en el servidor: revisa la lista de pedidos en unos minutos.`,
                  ),
                );
            })
            .catch(() =>
              reject(new Error(`Tiempo de espera agotado importando ${fileName}`)),
            );
        }, 5 * 60 * 1000);

        waiters.set(jobId, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      }),
    close: () => es.close(),
  };
}

export default function CrearPedidoForm() {
  const [isSending, setIsSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [showError, setShowError] = useState(false);
  /** Por qué falló la subida. Vacío = el aviso de «no elegiste ningún archivo». */
  const [motivoError, setMotivoError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState("");

  const handleFilesChange = (incoming: File | File[] | FileList) => {
    // Convertir FileList a array si es necesario
    const newFiles =
      incoming instanceof FileList
        ? Array.from(incoming)
        : Array.isArray(incoming)
          ? incoming
          : [incoming];

    setFiles((prev) => [...prev, ...newFiles]);
    setShowError(false); // Ocultar error cuando se añadan archivos
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const processFile = async (file: File): Promise<any> => {
    // Detección de encoding.
    //
    // La versión anterior hacía: si al leer como UTF-8 aparece UN "�", releer TODO
    // como ISO-8859-1. Eso es peligroso: un CSV UTF-8 correcto con un único byte
    // basura hacía que se releyeran TODOS los acentos como latin-1, corrompiendo
    // cada nombre ("PADRÓN" -> "PADRÃN") y creando vendedores fantasma.
    //
    // Ahora: se valida UTF-8 en estricto. Solo si el archivo NO es UTF-8 válido y
    // además tiene MUCHOS bytes inválidos (típico de un latin-1 con acentos), se
    // relee como windows-1252. Con basura puntual se prefiere perder ese carácter
    // antes que corromper el archivo entero.
    const detectEncoding = async (file: File): Promise<string> => {
      const buf = await file.arrayBuffer();

      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf);

        return "UTF-8";
      } catch {
        const laxo = new TextDecoder("utf-8").decode(buf);
        const invalidos = (laxo.match(/�/g) || []).length;
        const umbral = Math.max(2, Math.floor(laxo.length * 0.001));

        return invalidos <= umbral ? "UTF-8" : "windows-1252";
      }
    };

    const encoding = await detectEncoding(file);

    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: encoding,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (files.length === 0) {
      setMotivoError(null);
      setShowError(true);

      return;
    }

    setShowError(false);
    setMotivoError(null);
    setIsSending(true);
    setProgress(0);

    // Canal SSE de la cola de importación. Se abre ANTES de mandar nada.
    //
    // Antes se abría al recibir el primer 202, o sea DESPUÉS de encolar: el worker
    // ya estaba procesando cuando aún no había nadie escuchando, y si terminaba
    // rápido el aviso de "listo" se publicaba al vacío y se perdía. La pantalla
    // entonces esperaba en balde hasta agotar el tope. Con el canal abierto y
    // confirmado (`ready`) antes del primer envío, ese hueco no existe.
    //
    // Cuesta una conexión aunque el backend acabe procesando en línea (200 en vez
    // de 202) y no haga falta. Es un precio ridículo comparado con dejar a alguien
    // mirando un botón que gira.
    let importStream: Awaited<ReturnType<typeof openImportStream>> | null = null;

    try {
      try {
        importStream = await openImportStream();
      } catch {
        // Sin canal se sigue igual: si el backend procesa en línea (200) no hace
        // falta para nada, y si encola, `wait` tiene su propio tope y avisa. Peor
        // seria abortar una subida que quizá no lo necesita.
        importStream = null;
      }

      const totalFiles = files.length;
      let processedFiles = 0;
      const batchSize = 50; // Procesar 50 registros por request

      for (const file of files) {
        setCurrentFile(`Procesando: ${file.name}`);

        // Parsear CSV
        const records = await processFile(file);

        // Dividir en lotes
        const batches = [];

        for (let i = 0; i < records.length; i += batchSize) {
          batches.push(records.slice(i, i + batchSize));
        }

        // Enviar cada lote con delay
        for (let i = 0; i < batches.length; i++) {
          setCurrentFile(`${file.name} - Lote ${i + 1}/${batches.length}`);

          const response = await fetch(`${getApiBaseUrl()}/orders/bulk`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ records: batches[i] }),
          });

          if (!response.ok) {
            /**
             * El motivo lo dice el servidor, y hay que enseñarlo.
             *
             * Antes se tiraba y se ponía «Error al procesar <archivo>». El de verdad
             * —«Colisión de vendedor: el código 'mario.hechavarria' ya pertenece a
             * 'MARIO CESAR HECHAVARRIA ABREU', pero el archivo trae 'MARIO HECHAVARRIA
             * ABREU'»— sólo aparecía en la consola del navegador, así que para saber por
             * qué no entraba un archivo había que abrir las herramientas de desarrollo.
             */
            const detalle = await response
              .json()
              .then((j) => j?.error)
              .catch(() => null);

            throw new Error(detalle || `Error al procesar ${file.name} (${response.status})`);
          }

          // Cola activa: el backend encoló (202 { jobId }). Esperamos por SSE a que el
          // worker termine este lote antes de seguir, para que "éxito" signifique
          // realmente procesado (y que una colisión de vendedor se muestre como error).
          if (response.status === 202) {
            const { jobId } = await response.json();

            if (!importStream) importStream = await openImportStream();
            if (!importStream) {
              // Sin canal no hay forma de saber cómo acabó. Se dice, en vez de reventar
              // con un «no se puede leer wait de null» que no ayuda a nadie.
              throw new Error(
                `El archivo se envió pero no se pudo abrir el canal para saber cómo acabó. ` +
                  `Mira la lista de pedidos en un minuto antes de volver a subirlo.`,
              );
            }
            await importStream.wait(String(jobId), file.name);
          } else if (i < batches.length - 1) {
            // Modo inline (sin cola): esperar 50ms entre requests como antes.
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          // Actualizar progreso
          const batchProgress =
            ((processedFiles + (i + 1) / batches.length) / totalFiles) * 100;

          setProgress(Math.round(batchProgress));
        }

        processedFiles++;
      }

      setProgress(100);

      // Si todo sale bien, limpiar los archivos
      setFiles([]);
      setCurrentFile("");

      addToast({
        title: "Subido exitosamente",
        description: `${totalFiles} archivos procesados correctamente`,
        color: "success",
      });

      // Esperar un poco antes de resetear el progreso
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setProgress(0);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Upload error:", error);

      const motivo =
        error instanceof Error && error.message
          ? error.message
          : "Error al procesar los archivos";

      setMotivoError(motivo);
      setShowError(true);

      addToast({
        title: "No se importó",
        // El motivo, tal cual lo da el servidor. Un «Error» a secas obliga a adivinar.
        description: motivo,
        color: "danger",
        // Los motivos son largos —dicen con quién choca y qué hacer— y con los segundos
        // de siempre no da tiempo ni a leerlo.
        timeout: 15000,
      });
    } finally {
      importStream?.close();
      setIsSending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 justify-between h-full"
      onSubmit={handleSubmit}
    >
      <Card className="md:p-6">
        <CardBody className="space-y-3">
          {showError && (
            /* El aviso se queda en pantalla: el toast se va solo y estos motivos hay
               que poder releerlos —y copiarlos— para arreglar el archivo o la ficha. */
            <Alert
              color="danger"
              description={
                motivoError ??
                "Por favor, seleccione al menos un archivo antes de continuar."
              }
              title={motivoError ? "No se importó" : "No hay archivos para enviar"}
              variant="flat"
            />
          )}
          <div className="text-lg font-bold text-primary">
            Importar Archivos
          </div>
          <div className="flex flex-col md:flex-row gap-8 items-stretch">
            <div className="w-full relative z-10">
              <div className="absolute inset-0 z-0 w-full flex items-center justify-center">
                <h2 className="text-center text-lg text-primary font-semibold px-5">
                  Arraste los archivos aquí o click para buscarlos <br />
                  (Formatos aceptados: .csv)
                </h2>
              </div>
              <FileUploader
                multiple
                classes="drag-drop-file-uploader"
                handleChange={handleFilesChange}
                maxSize={2024}
                name="file"
                types={fileTypes}
              />
            </div>
            <div className="md:min-w-sm">
              <p className="text-sm font-semibold mb-2">
                Archivos cargados: ({files.length})
              </p>
              <div className="flex flex-col gap-2">
                {files.length === 0 && (
                  <Card>
                    <CardBody>
                      <div className="flex gap-4 items-center">
                        <Icons.empty className="size-6 text-primary" />
                        <span className="text-primary font-semibold">
                          No hay archivos cargados.
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                )}
                {files.map((file, index) => (
                  <Card key={`${file.name}-${index}`}>
                    <CardBody>
                      <div className="flex gap-4 items-center justify-between">
                        <div className="flex items-center">
                          <Icons.csv className="size-8 text-primary" />
                          <span className="text-primary font-semibold">
                            {file.name}
                          </span>
                        </div>
                        <Button
                          color="danger"
                          isDisabled={isSending}
                          isIconOnly={true}
                          variant="flat"
                          onPress={() => removeFile(index)}
                        >
                          <Icons.trash className="size-6" />
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </CardBody>
        <CardFooter className="flex flex-col gap-4">
          {isSending && (
            <div className="w-full space-y-2">
              <Progress
                showValueLabel
                color="primary"
                label={
                  currentFile ? `Procesando: ${currentFile}` : "Procesando..."
                }
                size="md"
                value={progress}
              />
            </div>
          )}
          <Button
            className="min-w-full md:min-w-xs font-semibold"
            color="primary"
            isLoading={isSending}
            size="lg"
            startContent={!isSending && <Icons.upload className="size-6" />}
            type="submit"
            variant="solid"
          >
            Enviar
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
