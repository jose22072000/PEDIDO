import {
  Button,
  Chip,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  Spinner,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";
import { copyTextToClipboard } from "@/lib/utils";
import { registrarCopia } from "@/lib/registrar-copia";

/**
 * EL CONSUMO PROPIO DE CADA VENDEDOR, A UN CLIC.
 *
 * El consumo propio es el cliente donde el vendedor mete al que compra poco y no tiene
 * ficha. Cada uno tiene el suyo, sube un pedido grande y lo va reutilizando: es el pedido
 * que más veces se copia para facturar en todo el día.
 *
 * Y era el más difícil de encontrar. Había que filtrar la lista por el vendedor, mirar
 * cuál de sus pedidos era el del consumo y abrirlo. Tres pasos por cada venta suelta, y
 * la lista tiene miles.
 *
 * Aquí está uno por vendedor —el ÚLTIMO que subió, que es el que se está reutilizando— y
 * el botón copia directamente lo que se pega en la factura. No hay que abrir nada: quien
 * quiera ver el pedido entero lo busca en la lista, que para eso está.
 *
 * Cajón y no modal, y en las dos pantallas: esto se abre AL LADO del trabajo, se copia y
 * se cierra. Un modal centrado taparía la lista de pedidos que se está mirando.
 */
type Consumo = {
  pedidoId: string;
  folio: string;
  fecha: string | null;
  subidoAt: string;
  estado: string | null;
  lineas: number;
  vendedorId: string | null;
  vendedorNombre: string;
  clienteId: string | null;
  clienteNombre: string;
  clienteCodigo: string;
};

const cuando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";

export const ConsumoPropio = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${getApiBaseUrl()}/orders/consumo-propio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudo leer el consumo propio");
      setConsumos(data.consumos ?? []);
    } catch (e) {
      addToast({
        title: "No se pudo abrir el consumo propio",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, []);

  // Se recarga CADA VEZ que se abre: mientras está cerrado pueden haber entrado
  // pedidos nuevos, y lo que se copia de aquí tiene que ser el último de verdad.
  useEffect(() => {
    if (isOpen) void cargar();
  }, [isOpen, cargar]);

  const copiar = async (c: Consumo) => {
    const texto = `P-${c.folio}; V-${c.vendedorNombre}; C-${c.clienteCodigo};`;
    const ok = await copyTextToClipboard(texto);

    if (!ok) {
      addToast({
        title: "No se pudo copiar",
        description: "Ábrelo desde la lista de pedidos y cópialo desde ahí.",
        color: "warning",
      });

      return;
    }

    // La misma marca que el botón de la lista: es la copia que mide el uso real
    // del puente con el sistema contable.
    registrarCopia({
      tipo: "pedido",
      pedidoId: c.pedidoId,
      vendedorId: c.vendedorId ?? undefined,
      clienteId: c.clienteId ?? undefined,
    });
    setCopiado(c.pedidoId);
    setTimeout(() => setCopiado(null), 2000);
  };

  return (
    <Drawer isOpen={isOpen} placement="right" size="md" onClose={onClose}>
      <DrawerContent>
        <DrawerHeader className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <Icons.users className="size-5 text-primary" />
            Consumo propio
          </span>
          <span className="text-xs font-normal text-default-500">
            El último pedido de consumo de cada vendedor, listo para copiar en la factura.
          </span>
        </DrawerHeader>
        <DrawerBody className="gap-3">
          {cargando && (
            <div className="flex justify-center py-10">
              <Spinner color="primary" />
            </div>
          )}

          {!cargando && !consumos.length && (
            <div className="py-10 text-center text-sm text-default-400">
              Ningún vendedor de esta sucursal tiene todavía un cliente de consumo propio.
              <span className="mt-2 block text-xs">
                Se reconoce por el nombre del cliente: que lleve «consumo propio».
              </span>
            </div>
          )}

          {!cargando &&
            consumos.map((c) => (
              <div
                key={c.pedidoId}
                className="rounded-large border border-default-200 p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.vendedorNombre}</p>
                    <p className="truncate text-xs text-default-500">{c.clienteNombre}</p>
                  </div>
                  <Chip size="sm" variant="flat">
                    {c.lineas} línea{c.lineas === 1 ? "" : "s"}
                  </Chip>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-default-600">{c.folio}</p>
                    <p className="text-[11px] text-default-400">
                      Subido el {cuando(c.subidoAt)}
                    </p>
                  </div>
                  <Button
                    color={copiado === c.pedidoId ? "success" : "primary"}
                    size="sm"
                    startContent={
                      copiado === c.pedidoId ? (
                        <Icons.check className="size-4" />
                      ) : (
                        <Icons.copy className="size-4" />
                      )
                    }
                    variant={copiado === c.pedidoId ? "flat" : "solid"}
                    onPress={() => copiar(c)}
                  >
                    {copiado === c.pedidoId ? "Copiado" : "Copiar"}
                  </Button>
                </div>
              </div>
            ))}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
