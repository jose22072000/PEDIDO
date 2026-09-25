import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  Input,
  Spinner,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";
import { copyTextToClipboard } from "@/lib/utils";
import { registrarCopia } from "@/lib/registrar-copia";

/**
 * LOS VENDEDORES DE LA SUCURSAL, PARA COPIARLOS SIN SALIR DE PEDIDOS.
 *
 * Al facturar hay que pegar `V-NOMBRE;` en la observación, y el nombre va COMPLETO y
 * escrito como está en el sistema: si se teclea a mano y sobra un acento o falta un
 * apellido, ese pedido no cruza con su factura. De eso vive todo el cotejo.
 *
 * Copiarlo ya se podía, pero en la vista de Vendedores: salir de Pedidos, buscar,
 * copiar y volver. La operadora está en Pedidos toda la mañana, así que el atajo vive
 * aquí, al lado del de consumo propio y con la misma forma.
 *
 * Se lee de `/vendedores`, que ya devuelve los de la sucursal de quien mira: incluye a
 * los que NO usan la aplicación —los que se dan de alta sólo con su sucursal, que son
 * precisamente para esto— y deja fuera los de las demás sucursales.
 */
type Vendedor = {
  id: string;
  nombre: string;
  activo?: boolean;
};

/** Sin tildes y en minúsculas, para que «Muñoz» se encuentre escribiendo «munoz». */
const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const VendedoresCopiar = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${getApiBaseUrl()}/vendedores`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "No se pudieron leer los vendedores");
      // Los dados de baja no salen: no se les puede facturar nada nuevo.
      setVendedores((Array.isArray(data) ? data : []).filter((v: Vendedor) => v.activo !== false));
    } catch (e) {
      addToast({
        title: "No se pudo abrir la lista de vendedores",
        description: e instanceof Error ? e.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void cargar();
    else setBusqueda("");
  }, [isOpen, cargar]);

  const mostrados = useMemo(() => {
    const q = plano(busqueda.trim());

    if (!q) return vendedores;

    return vendedores.filter((v) => plano(v.nombre).includes(q));
  }, [vendedores, busqueda]);

  const copiar = async (v: Vendedor) => {
    // EXACTAMENTE el mismo texto que la vista de Vendedores. Dos formas distintas de
    // escribir lo mismo serían dos formas de que una no cruce.
    const ok = await copyTextToClipboard(`V-${v.nombre};`);

    if (!ok) {
      addToast({
        title: "No se pudo copiar",
        description: "Cópialo desde la vista de Vendedores.",
        color: "warning",
      });

      return;
    }

    registrarCopia({ tipo: "vendedor", vendedorId: v.id });
    setCopiado(v.id);
    setTimeout(() => setCopiado(null), 2000);
  };

  return (
    <Drawer isOpen={isOpen} placement="right" size="md" onClose={onClose}>
      <DrawerContent>
        <DrawerHeader className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <Icons.user className="size-5 text-primary" />
            Vendedores
          </span>
          <span className="text-xs font-normal text-default-500">
            Copia el <span className="font-mono">V-NOMBRE;</span> para pegarlo en la factura.
          </span>
          <Input
            isClearable
            placeholder="Buscar vendedor…"
            size="sm"
            startContent={<Icons.search className="size-4 text-default-400" />}
            value={busqueda}
            onClear={() => setBusqueda("")}
            onValueChange={setBusqueda}
          />
        </DrawerHeader>
        <DrawerBody className="gap-2">
          {cargando && (
            <div className="flex justify-center py-10">
              <Spinner color="primary" />
            </div>
          )}

          {!cargando && !mostrados.length && (
            <div className="py-10 text-center text-sm text-default-400">
              {vendedores.length
                ? "Ningún vendedor con ese nombre."
                : "Esta sucursal no tiene vendedores activos."}
            </div>
          )}

          {!cargando &&
            mostrados.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-large border border-default-200 p-2.5"
              >
                <span className="min-w-0 truncate text-sm font-medium">{v.nombre}</span>
                <Button
                  color={copiado === v.id ? "success" : "primary"}
                  size="sm"
                  startContent={
                    copiado === v.id ? (
                      <Icons.check className="size-4" />
                    ) : (
                      <Icons.copy className="size-4" />
                    )
                  }
                  variant={copiado === v.id ? "flat" : "solid"}
                  onPress={() => copiar(v)}
                >
                  {copiado === v.id ? "Copiado" : "Copiar"}
                </Button>
              </div>
            ))}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
