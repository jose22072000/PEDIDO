import { Select, SelectItem } from "@heroui/react";
import { useEffect, useState } from "react";

import Icons from "@/components/icons/iconify";
import { useAuthStore } from "@/stores/authStore";
import { getApiBaseUrl } from "@/config";
import { SUCURSAL_ACTIVA_KEY, TODAS, getSucursalActiva } from "@/lib/sucursal-activa";

/**
 * Sucursal en la que el Super Admin está "enfocado".
 *
 * El Super Admin es global y no tiene sucursal propia: por defecto ve TODAS. Con este
 * selector puede concentrarse en una sola. La elección se guarda aquí y el wrapper de
 * fetch (main.tsx) la manda como header `x-sucursal-id` en cada petición.
 *
 * Los demás usuarios no ven el selector: siempre operan en su sucursal.
 */
// La clave y la limpieza viven en `lib/sucursal-activa`: las lee tambien el
// envoltorio de fetch, y tener dos reglas para el mismo valor fue justo lo que
// dejo a las operadoras sin ver nada.
export { SUCURSAL_ACTIVA_KEY, getSucursalActiva } from "@/lib/sucursal-activa";

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

  return (
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
  );
};
