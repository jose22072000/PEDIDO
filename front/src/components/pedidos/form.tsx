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
import { API_BASE_URL } from "@/config";

const fileTypes: string[] = ["CSV"];

export default function CrearPedidoForm() {
  const [isSending, setIsSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [showError, setShowError] = useState(false);
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
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
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
      setShowError(true);

      return;
    }

    setShowError(false);
    setIsSending(true);
    setProgress(0);

    try {
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

          const response = await fetch(`${API_BASE_URL}/orders/bulk`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ records: batches[i] }),
          });

          if (!response.ok) {
            throw new Error(`Error al procesar ${file.name}`);
          }

          // Esperar 50ms entre requests
          if (i < batches.length - 1) {
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
      setShowError(true);

      addToast({
        title: "Error",
        description: "Error al procesar los archivos",
        color: "danger",
      });
    } finally {
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
            <Alert
              color="danger"
              description="Por favor, seleccione al menos un archivo antes de continuar."
              title="No hay archivos para enviar"
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
