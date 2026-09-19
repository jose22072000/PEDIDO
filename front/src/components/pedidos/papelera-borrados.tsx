import {
  Button,
  Chip,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  addToast,
} from "@heroui/react";
import { type ElementType, useCallback, useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { usePantallaChica } from "@/hooks/pantalla";
import { getApiBaseUrl } from "@/config";

/**
 * LO QUE SE BORRÓ Y NO VUELVE A ENTRAR SOLO.
 *
 * El archivo del vendedor se relee cada pocos minutos, así que antes borrar un pedido
 * duraba hasta la siguiente pasada: volvía entero. Ahora queda una nota y la ingesta lo
 * salta — pero entonces un borrado por error no tendría vuelta atrás ni subiendo el
 * archivo otra vez. Para eso está esta pantalla.
 *
 * No resucita nada: quita el freno. El pedido vuelve en la siguiente importación del
 * archivo que lo trae, con SU folio, porque el sufijo se le quedó reservado.
 */
type Borrado = {
  id: string;
  folio: string;
  folioBase: string;
  clienteNombre: string | null;
  vendedorNombre: string | null;
  lineas: number | null;
  fecha: string | null;
  borradoPor: string | null;
  createdAt: string;
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const PapeleraBorrados = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [borrados, setBorrados] = useState<Borrado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [soltando, setSoltando] = useState<string | null>(null);

  const pantallaChica = usePantallaChica();
  // Mismo contenido, distinto envase: cajón en el teléfono, modal en el escritorio.
  const Envase: ElementType = pantallaChica ? Drawer : Modal;
  const EnvaseContenido: ElementType = pantallaChica ? DrawerContent : ModalContent;
  const EnvaseCabecera: ElementType = pantallaChica ? DrawerHeader : ModalHeader;
  const EnvaseCuerpo: ElementType = pantallaChica ? DrawerBody : ModalBody;
  const EnvasePie: ElementType = pantallaChica ? DrawerFooter : ModalFooter;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${getApiBaseUrl()}/orders/borrados`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo leer la papelera");
      setBorrados(data.borrados ?? []);
    } catch (e) {
      addToast({
        title: "No se pudo abrir la papelera",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void cargar();
  }, [isOpen, cargar]);

  const dejarEntrar = async (b: Borrado) => {
    setSoltando(b.id);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${getApiBaseUrl()}/orders/borrados/${b.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo quitar la nota");

      setBorrados((xs) => xs.filter((x) => x.id !== b.id));
      addToast({
        title: "Podrá volver a entrar",
        description: data.message,
        color: "success",
      });
    } catch (e) {
      addToast({
        title: "No se pudo",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setSoltando(null);
    }
  };

  return (
    <Envase
      isOpen={isOpen}
      {...(pantallaChica ? { placement: "right" } : { placement: "center", size: "3xl", scrollBehavior: "inside" })}
      onClose={onClose}
    >
      <EnvaseContenido>
        <EnvaseCabecera className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <Icons.trash className="size-5 text-danger" />
            Pedidos borrados
          </span>
          <span className="text-xs font-normal text-default-500">
            Estos no vuelven a entrar aunque se suba otra vez el archivo. Si fue un error,
            quita la nota y volverán en la próxima importación, con su mismo folio.
          </span>
        </EnvaseCabecera>

        <EnvaseCuerpo>
          {cargando ? (
            <div className="flex justify-center py-8">
              <Spinner color="primary" />
            </div>
          ) : borrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-default-500">
              No hay ningún pedido borrado. Lo que se borre desde aquí aparecerá en esta
              lista.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {borrados.map((b) => (
                <div
                  key={b.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-default-200 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{b.folio}</span>
                      {b.folio !== b.folioBase && (
                        // El sufijo es NUESTRO y separa a los clientes de un mismo folio:
                        // decir cuál era evita que alguien lo lea como otro pedido.
                        <Chip size="sm" variant="flat">
                          del folio {b.folioBase}
                        </Chip>
                      )}
                      {b.lineas != null && (
                        <Chip size="sm" variant="flat">
                          {b.lineas} línea{b.lineas === 1 ? "" : "s"}
                        </Chip>
                      )}
                    </div>
                    <p className="text-sm text-default-600 truncate">
                      {b.clienteNombre || "Sin cliente"} · {b.vendedorNombre || "Sin vendedor"}
                    </p>
                    <p className="text-xs text-default-400">
                      Del {fecha(b.fecha)} · lo borró {b.borradoPor || "alguien"} el {cuando(b.createdAt)}
                    </p>
                  </div>
                  <Button
                    color="primary"
                    isLoading={soltando === b.id}
                    size="sm"
                    variant="flat"
                    onPress={() => dejarEntrar(b)}
                  >
                    Que vuelva a entrar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </EnvaseCuerpo>

        <EnvasePie>
          <Button variant="flat" onPress={onClose}>
            Cerrar
          </Button>
        </EnvasePie>
      </EnvaseContenido>
    </Envase>
  );
};
