import {
  Button,
  Card,
  CardBody,
  Chip,
  Select,
  SelectItem,
  addToast,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { getApiBaseUrl } from "@/config";

/**
 * Panel de Mantenimiento (solo Super Admin). Corre desde la UI lo que antes se hacía
 * por consola: subir el consolidado de geo, corregir códigos de vendedores, fusionar
 * duplicados y descargar un backup. Cada acción queda registrada en el servidor.
 */
interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
}

export const MantenimientoPanel = () => {
  const [estado, setEstado] = useState<any>(null);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [cargando, setCargando] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const [intoId, setIntoId] = useState("");
  const geoInputRef = useRef<HTMLInputElement>(null);

  const cargar = async () => {
    try {
      const [e, v] = await Promise.all([
        fetch(`${getApiBaseUrl()}/mantenimiento/estado`).then((r) => r.json()),
        fetch(`${getApiBaseUrl()}/vendedores/gestores`).then((r) => r.json()),
      ]);
      setEstado(e);
      setVendedores(v.vendedores ?? []);
    } catch {
      /* se reintenta al recargar */
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const ok = (t: string, d?: string) => addToast({ title: t, description: d, color: "success" });
  const err = (d: string) => addToast({ title: "Error", description: d, color: "danger" });

  // --- Subir geolocalización (xlsx) ---
  const subirGeo = async (file: File) => {
    setCargando("geo");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${getApiBaseUrl()}/geolocalizacion`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      ok(
        "Geolocalización importada",
        `${j.clientesConGeo}/${j.clientesTotal} clientes con ubicación · ${j.total.actualizados} actualizados`,
      );
      cargar();
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo importar");
    } finally {
      setCargando(null);
      if (geoInputRef.current) geoInputRef.current.value = "";
    }
  };

  // --- Recalcular códigos ---
  const recompute = async () => {
    setCargando("recompute");
    try {
      const res = await fetch(`${getApiBaseUrl()}/mantenimiento/recompute-codigos`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || (j.colisiones ? "Hay colisiones de código" : "Error"));
      ok("Códigos recalculados", `${j.cambiados} cambiados · ${j.yaCorrectos} ya correctos`);
      cargar();
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo recalcular");
    } finally {
      setCargando(null);
    }
  };

  // --- Fusionar vendedores ---
  const merge = async (dry: boolean) => {
    if (!fromId || !intoId || fromId === intoId) return err("Elige dos vendedores distintos.");
    setCargando("merge");
    try {
      const res = await fetch(`${getApiBaseUrl()}/mantenimiento/merge-vendedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId, intoId, dry }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      if (dry) {
        ok("Simulación", `Movería ${j.aMover}, eliminaría ${j.aBorrar} duplicados. Quedaría con ${j.quedaria}.`);
      } else {
        ok("Vendedores fusionados", `Movidos ${j.aMover} · eliminados ${j.aBorrar} · queda con ${j.quedaria}`);
        setFromId("");
        setIntoId("");
        cargar();
      }
    } catch (e) {
      err(e instanceof Error ? e.message : "No se pudo fusionar");
    } finally {
      setCargando(null);
    }
  };

  // --- Backup ---
  const backup = () => {
    window.open(`${getApiBaseUrl()}/mantenimiento/backup`, "_blank");
  };

  const t = estado?.totales;
  const dup = estado?.alertas?.posiblesDuplicados?.length ?? 0;

  return (
    <Card className={cards()}>
      <CardBody>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <Icons.configuracion className="size-6 text-primary" />
            <h3 className="text-lg font-semibold">Mantenimiento (Super Admin)</h3>
          </div>

          {/* Resumen */}
          {t && (
            <div className="flex flex-wrap gap-2">
              <Chip variant="flat">{t.pedidos} pedidos</Chip>
              <Chip variant="flat">{t.vendedores} vendedores</Chip>
              <Chip color="success" variant="flat">
                {t.clientesConGeo} con ubicación
              </Chip>
              {t.clientesSinGeo > 0 && (
                <Chip color="warning" variant="flat">
                  {t.clientesSinGeo} sin ubicación
                </Chip>
              )}
              {dup > 0 && (
                <Chip color="danger" variant="flat">
                  {dup} posibles duplicados
                </Chip>
              )}
            </div>
          )}

          {/* Geo */}
          <div className="p-4 border rounded-lg">
            <p className="mb-1 font-semibold">Actualizar datos de clientes (Parranda)</p>
            <p className="mb-3 text-sm text-default-500">
              Sube el <b>Consolidado de Geolocalización</b> (.xlsx). Rellena dirección,
              municipio, tipo, estado y la ubicación de los clientes existentes.
            </p>
            <input
              ref={geoInputRef}
              accept=".xlsx,.xls"
              className="hidden"
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) subirGeo(f);
              }}
            />
            <Button
              color="primary"
              isLoading={cargando === "geo"}
              startContent={<Icons.upload className="size-4" />}
              variant="flat"
              onPress={() => geoInputRef.current?.click()}
            >
              Subir Excel de geolocalización
            </Button>
          </div>

          {/* Recompute */}
          <div className="p-4 border rounded-lg">
            <p className="mb-1 font-semibold">Corregir códigos de vendedores</p>
            <p className="mb-3 text-sm text-default-500">
              Regenera el código de cada vendedor (nombre.apellido, sin tildes). Útil si
              alguno quedó con el código viejo o con caracteres raros.
            </p>
            <Button
              isLoading={cargando === "recompute"}
              startContent={<Icons.edit className="size-4" />}
              variant="flat"
              onPress={recompute}
            >
              Recalcular códigos
            </Button>
          </div>

          {/* Merge */}
          <div className="p-4 border rounded-lg">
            <p className="mb-1 font-semibold">Fusionar vendedores duplicados</p>
            <p className="mb-3 text-sm text-default-500">
              Une dos entradas de la misma persona. Los pedidos del primero pasan al
              segundo; los duplicados exactos se eliminan. El primero se borra.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                aria-label="Vendedor a fusionar (se elimina)"
                label="Se elimina"
                selectedKeys={fromId ? new Set([fromId]) : new Set()}
                size="sm"
                variant="bordered"
                onSelectionChange={(k) => setFromId(Array.from(k)[0] as string)}
              >
                {vendedores.map((v) => (
                  <SelectItem key={v.id}>{`${v.nombre} (${v.codigo ?? "sin código"})`}</SelectItem>
                ))}
              </Select>
              <Select
                aria-label="Vendedor destino (se conserva)"
                label="Se conserva"
                selectedKeys={intoId ? new Set([intoId]) : new Set()}
                size="sm"
                variant="bordered"
                onSelectionChange={(k) => setIntoId(Array.from(k)[0] as string)}
              >
                {vendedores.map((v) => (
                  <SelectItem key={v.id}>{`${v.nombre} (${v.codigo ?? "sin código"})`}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                isLoading={cargando === "merge"}
                size="sm"
                variant="flat"
                onPress={() => merge(true)}
              >
                Simular
              </Button>
              <Button
                color="warning"
                isLoading={cargando === "merge"}
                size="sm"
                variant="flat"
                onPress={() => merge(false)}
              >
                Fusionar
              </Button>
            </div>
          </div>

          {/* Backup */}
          <div className="p-4 border rounded-lg">
            <p className="mb-1 font-semibold">Backup completo</p>
            <p className="mb-3 text-sm text-default-500">
              Descarga un JSON con todos los datos (pedidos, clientes, vendedores,
              usuarios). Para respaldo o traspaso.
            </p>
            <Button
              startContent={<Icons.download className="size-4" />}
              variant="flat"
              onPress={backup}
            >
              Descargar backup
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
