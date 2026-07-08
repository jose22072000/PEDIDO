import { Select, SelectItem, Chip } from "@heroui/react";
import { useEffect, useState } from "react";

import Icons from "@/components/icons/iconify";
import { useAuthStore } from "@/stores/authStore";
import { getApiBaseUrl } from "@/config";

/**
 * Sucursal en la que el Super Admin está "enfocado".
 *
 * El Super Admin es global y no tiene sucursal propia: por defecto ve TODAS. Con este
 * selector puede concentrarse en una sola. La elección se guarda aquí y el wrapper de
 * fetch (main.tsx) la manda como header `x-sucursal-id` en cada petición.
 *
 * Los demás usuarios no ven el selector: siempre operan en su sucursal.
 */
export const SUCURSAL_ACTIVA_KEY = "sucursal_activa";
const TODAS = "__todas__";

export function getSucursalActiva(): string | null {
  if (typeof window === "undefined") return null;

  return localStorage.getItem(SUCURSAL_ACTIVA_KEY) || null;
}

interface Sucursal {
  id: string;
  nombre: string;
  codigo: string | null;
}

export const SucursalSelector = () => {
  const { session } = useAuthStore();
  const esGlobal = Boolean(session?.isGlobalAdmin);

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [valor, setValor] = useState<string>(() => getSucursalActiva() ?? TODAS);

  useEffect(() => {
    if (!esGlobal) return;
    fetch(`${getApiBaseUrl()}/sucursales`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSucursales(Array.isArray(data) ? data : []))
      .catch(() => setSucursales([]));
  }, [esGlobal]);

  if (!esGlobal) return null;

  const cambiar = (id: string) => {
    if (!id || id === valor) return;
    setValor(id);
    if (id === TODAS) localStorage.removeItem(SUCURSAL_ACTIVA_KEY);
    else localStorage.setItem(SUCURSAL_ACTIVA_KEY, id);
    // Las vistas ya cargaron sus datos con el scope anterior: se recarga para que
    // vuelvan a pedirlos con la sucursal nueva.
    window.location.reload();
  };

  const actual = sucursales.find((s) => s.id === valor);

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Sucursal activa"
        className="w-full sm:w-64"
        selectedKeys={new Set([valor])}
        size="sm"
        startContent={<Icons.building className="size-4 text-default-400" />}
        variant="bordered"
        onSelectionChange={(keys) => cambiar(Array.from(keys)[0] as string)}
      >
        {[
          <SelectItem key={TODAS}>Todas las sucursales</SelectItem>,
          ...sucursales.map((s) => (
            <SelectItem key={s.id}>
              {s.codigo ? `${s.nombre} · ${s.codigo}` : s.nombre}
            </SelectItem>
          )),
        ]}
      </Select>
      <Chip
        color={valor === TODAS ? "primary" : "success"}
        size="sm"
        variant="flat"
      >
        {valor === TODAS ? "Todas" : (actual?.codigo ?? "Enfocado")}
      </Chip>
    </div>
  );
};
