import {
  Card,
  CardBody,
  Button,
  Input,
  Spinner,
  Chip,
  Select,
  SelectItem,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cards } from "../primitives";
import Icons from "../icons/iconify";

import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/config";

interface Gestor {
  id: string;
  username: string;
  sucursalId: string | null;
  sucursal?: { nombre: string; codigo: string | null } | null;
}

interface Vendedor {
  id: string;
  nombre: string;
  codigo: string | null;
  gestorId: string | null;
  activo: boolean;
  gestor?: { id: string; username: string } | null;
  sucursal?: { nombre: string; codigo: string | null } | null;
  _count?: { pedidos: number };
}

interface GestoresResponse {
  gestores: Gestor[];
  vendedores: Vendedor[];
  sinAsignar: number;
  inactivos: number;
}

const SIN_ASIGNAR = "__sin_asignar__";

export const GestoresList = () => {
  const [data, setData] = useState<GestoresResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/vendedores/gestores`);

      if (!res.ok) throw new Error("No se pudo cargar la lista de gestores");
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Enlazar / desenlazar el vendedor a un gestor. Al enlazar, el backend rellena
  // la sucursal de sus pedidos y clientes -> dejan de estar ocultos.
  const setGestor = async (vendedor: Vendedor, gestorId: string | null) => {
    setSavingId(vendedor.id);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/vendedores/${vendedor.id}/gestor`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gestorId }),
        },
      );
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || "No se pudo enlazar");

      const b = json.backfill;

      addToast({
        title: gestorId ? "Vendedor enlazado" : "Vendedor sin asignar",
        description:
          gestorId && b
            ? `Se asignaron ${b.pedidos} pedidos y ${b.clientes} clientes a la sucursal del gestor.`
            : "El vendedor quedó sin gestor.",
        color: gestorId ? "success" : "warning",
      });
      await fetchData();
    } catch (err) {
      addToast({
        title: "Error",
        description: err instanceof Error ? err.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setSavingId(null);
    }
  };

  // Baja/alta del vendedor. La baja NO borra pedidos: solo deja de aceptar su CSV.
  const setActivo = async (vendedor: Vendedor, activo: boolean) => {
    setSavingId(vendedor.id);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/vendedores/${vendedor.id}/activo`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activo }),
        },
      );
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || "No se pudo actualizar");

      addToast({
        title: activo ? "Vendedor reactivado" : "Vendedor dado de baja",
        description: activo
          ? "Vuelve a aceptarse su CSV de pedidos."
          : `Se dejará de aceptar su CSV. Se conservan ${json.pedidosConservados} pedidos del histórico.`,
        color: activo ? "success" : "warning",
      });
      await fetchData();
    } catch (err) {
      addToast({
        title: "Error",
        description: err instanceof Error ? err.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setSavingId(null);
    }
  };

  const vendedores = useMemo(() => {
    const list = data?.vendedores ?? [];
    const q = search.trim().toUpperCase();

    if (!q) return list;

    return list.filter(
      (v) =>
        v.nombre.toUpperCase().includes(q) ||
        (v.codigo ?? "").toUpperCase().includes(q) ||
        (v.gestor?.username ?? "").toUpperCase().includes(q),
    );
  }, [data, search]);

  const gestores = data?.gestores ?? [];

  return (
    <div className="flex flex-col w-full gap-4">
      {/* Resumen */}
      <Card className={cn(cards({ border: "default" }))}>
        <CardBody className="gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Chip color="default" size="lg" variant="flat">
              {data?.vendedores.length ?? 0} vendedores
            </Chip>
            <Chip color="warning" size="lg" variant="flat">
              {data?.sinAsignar ?? 0} sin asignar
            </Chip>
            <Chip color="danger" size="lg" variant="flat">
              {data?.inactivos ?? 0} de baja
            </Chip>
            <Chip color="primary" size="lg" variant="flat">
              {gestores.length} gestores
            </Chip>
          </div>

          {(data?.sinAsignar ?? 0) > 0 && (
            <div className="p-3 text-sm border rounded-lg bg-warning-50 border-warning-200 text-warning-700">
              Los pedidos de un vendedor <b>sin asignar</b> quedan <b>ocultos</b>{" "}
              hasta que le enlaces un gestor. Al enlazarlo, todos sus pedidos ya
              subidos se asignan automáticamente.
            </div>
          )}

          {gestores.length === 0 && (
            <div className="p-3 text-sm border rounded-lg bg-danger-50 border-danger-200 text-danger-700">
              No hay usuarios con rol <b>Gestor</b>. Créalos en{" "}
              <b>Usuarios</b> y asígnales su sucursal para poder enlazar
              vendedores.
            </div>
          )}

          <Input
            isClearable
            className="max-w-md"
            placeholder="Buscar por vendedor, código o gestor..."
            size="lg"
            startContent={<Icons.search className="size-5 text-default-400" />}
            value={search}
            variant="bordered"
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
          />
        </CardBody>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner color="primary" size="lg" />
        </div>
      )}

      {error && (
        <Card>
          <CardBody className="py-6 text-center">
            <p className="text-danger">{error}</p>
            <Button className="mt-4" color="primary" onPress={fetchData}>
              Reintentar
            </Button>
          </CardBody>
        </Card>
      )}

      {!isLoading && !error && vendedores.length === 0 && (
        <Card>
          <CardBody className="py-10 text-center text-default-500">
            No hay vendedores. Se crean solos al importar el CSV de pedidos.
          </CardBody>
        </Card>
      )}

      {!isLoading &&
        !error &&
        vendedores.map((v) => (
          <Card
            key={v.id}
            className={cn(
              cards({ border: v.activo ? "default" : "danger" }),
              !v.activo && "opacity-70",
            )}
          >
            <CardBody className="gap-4">
              <div className="grid items-center grid-cols-1 gap-4 md:grid-cols-3">
                {/* Vendedor */}
                <div className="flex items-center gap-3 min-w-0">
                  <Icons.workers className="size-10 min-w-10 text-primary" />
                  <div className="flex flex-col min-w-0 gap-1">
                    <span className="text-sm font-bold truncate text-primary">
                      {v.nombre}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="px-1.5 py-0.5 text-xs bg-default-100 rounded select-all">
                        {v.codigo ?? "sin código"}
                      </code>
                      <span className="text-xs text-default-500">
                        {v._count?.pedidos ?? 0} pedidos
                      </span>
                    </div>
                  </div>
                </div>

                {/* Estado */}
                <div className="flex flex-wrap items-center gap-2">
                  {v.gestorId ? (
                    <Chip color="success" size="sm" variant="flat">
                      {v.gestor?.username}
                      {v.sucursal?.codigo ? ` · ${v.sucursal.codigo}` : ""}
                    </Chip>
                  ) : (
                    <Chip color="warning" size="sm" variant="flat">
                      Sin asignar — pedidos ocultos
                    </Chip>
                  )}
                  {!v.activo && (
                    <Chip color="danger" size="sm" variant="flat">
                      De baja
                    </Chip>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Select
                    aria-label="Gestor"
                    className="max-w-[14rem]"
                    isDisabled={savingId === v.id || gestores.length === 0}
                    placeholder="Sin asignar"
                    selectedKeys={new Set([v.gestorId ?? SIN_ASIGNAR])}
                    size="sm"
                    variant="bordered"
                    onSelectionChange={(keys) => {
                      const key = Array.from(keys)[0] as string | undefined;

                      if (!key || key === (v.gestorId ?? SIN_ASIGNAR)) return;
                      setGestor(v, key === SIN_ASIGNAR ? null : key);
                    }}
                  >
                    {[
                      <SelectItem key={SIN_ASIGNAR}>Sin asignar</SelectItem>,
                      ...gestores.map((g) => (
                        <SelectItem key={g.id}>
                          {`${g.username}${g.sucursal?.codigo ? ` · ${g.sucursal.codigo}` : ""}`}
                        </SelectItem>
                      )),
                    ]}
                  </Select>

                  <Button
                    color={v.activo ? "danger" : "success"}
                    isLoading={savingId === v.id}
                    size="sm"
                    variant="flat"
                    onPress={() => setActivo(v, !v.activo)}
                  >
                    {v.activo ? "Dar de baja" : "Reactivar"}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
    </div>
  );
};
