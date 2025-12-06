import { Input, Select, SelectItem, Chip, Switch } from "@heroui/react";
import { useEffect, useMemo } from "react";

import useNegocioCatalogStore from "@/stores/negocioCatalogStore";
import { useSucursalStore, useTrabajadorStore } from "@/stores/entityStores";
import { useAuthStore } from "@/stores/authStore";

type NegocioFilterType = "empresa" | "asignados";

interface NegocioFilterProps {
  type?: NegocioFilterType;
}

export const NegocioFilter = ({ type = "empresa" }: NegocioFilterProps) => {
  const filter = useNegocioCatalogStore((s) => s.filter);
  const setFilter = useNegocioCatalogStore((s) => s.setFilter);
  const selectedSucursal = useNegocioCatalogStore((s) => s.filterSucursalId);
  const setFilterSucursal = useNegocioCatalogStore((s) => s.setFilterSucursal);
  const selectedTrabajador = useNegocioCatalogStore(
    (s) => s.filterTrabajadorEmail,
  );
  const setFilterTrabajador = useNegocioCatalogStore(
    (s) => s.setFilterTrabajador,
  );
  const filterSinAsignar = useNegocioCatalogStore((s) => s.filterSinAsignar);
  const setFilterSinAsignar = useNegocioCatalogStore(
    (s) => s.setFilterSinAsignar,
  );
  const items = useNegocioCatalogStore((s) => s.items);
  const filteredItems = useNegocioCatalogStore((s) => s.filteredItems);

  // Listas completas de datos (entities)
  const sucursales = useSucursalStore((s) => s.items);
  const trabajadores = useTrabajadorStore((s) => s.items);
  const session = useAuthStore((s) => s.session);

  const rol = session?.rol;
  const sucursalId = session?.sucursalId;
  const usuarioId = session?.usuarioId; // email del trabajador

  // Determinar qué filtros mostrar según el rol
  const isAdmin = rol === "ADMIN";
  const isDirectivo = rol === "DIRECTIVO";
  const isGerente = rol === "GERENTE";
  const isSupervisor = rol === "SUPERVISOR";
  const isContador = rol === "CONTADOR";
  const isOperador = rol === "OPERADOR";
  const isVendedor = rol === "VENDEDOR";

  // Nivel empresa: admin y directivo ven todo
  const isEmpresaLevel = isAdmin || isDirectivo;
  // Nivel sucursal: gerente, supervisor, contador, operador
  const isSucursalLevel = isGerente || isSupervisor || isContador || isOperador;

  // En página de empresa: mostrar filtros según nivel
  // En página asignados: admin/directivo ven filtros, sucursal solo trabajador, vendedor nada
  const showSucursalFilter =
    type === "empresa" ? isEmpresaLevel : isEmpresaLevel;
  const showTrabajadorFilter =
    type === "empresa"
      ? isEmpresaLevel || isSucursalLevel
      : isEmpresaLevel || isSucursalLevel;
  const disableTrabajadorFilter = type === "asignados" && isVendedor;

  // Lista de trabajadores disponibles para el dropdown (depende de sucursal seleccionada)
  const filtrosListTrabajadores = useMemo(() => {
    if (!selectedSucursal || selectedSucursal === "__all__") {
      // Sin sucursal seleccionada: mostrar todos los trabajadores
      return trabajadores;
    }

    // Con sucursal seleccionada: solo trabajadores de esa sucursal
    return trabajadores.filter((t) => t.sucursalId === selectedSucursal);
  }, [trabajadores, selectedSucursal]);

  // Cuando cambia la sucursal seleccionada, limpiar trabajador seleccionado
  useEffect(() => {
    // Si hay un trabajador seleccionado, verificar si está en la nueva lista
    if (selectedTrabajador && selectedTrabajador !== "__all__") {
      const trabajadorExiste = filtrosListTrabajadores.some(
        (t) => t.email === selectedTrabajador,
      );

      if (!trabajadorExiste) {
        setFilterTrabajador(undefined);
      }
    }
  }, [
    selectedSucursal,
    filtrosListTrabajadores,
    selectedTrabajador,
    setFilterTrabajador,
  ]);

  // Aplicar filtros automáticos según el rol
  useEffect(() => {
    // Usuarios de sucursal solo ven negocios de su sucursal
    if (isSucursalLevel && sucursalId) {
      setFilterSucursal(sucursalId);
    }

    // Vendedores solo ven sus negocios asignados
    if (isVendedor && usuarioId) {
      setFilterTrabajador(usuarioId);
    }

    // Admin/Directivo no tienen filtros automáticos

    // Cleanup cuando cambia el tipo o rol
    return () => {
      if (type === "asignados") {
        setFilterTrabajador(undefined);
      }
    };
  }, [
    rol,
    sucursalId,
    usuarioId,
    isSucursalLevel,
    isVendedor,
    setFilterSucursal,
    setFilterTrabajador,
    type,
  ]);

  return (
    <div className="flex gap-2 w-full items-center flex-wrap">
      {showSucursalFilter && (
        <Select
          className="min-w-[150px]"
          label="Buscar Negocios por Sucursal"
          selectedKeys={
            selectedSucursal && selectedSucursal !== "__all__"
              ? new Set([selectedSucursal])
              : new Set(["__all__"])
          }
          size="lg"
          variant="bordered"
          onSelectionChange={(keys: any) => {
            const first = Array.from(keys || [])?.[0];
            const value =
              first && first !== "__all__" ? String(first) : undefined;

            setFilterSucursal(value);
          }}
        >
          <SelectItem key="__all__">Todas</SelectItem>
          {
            sucursales.map((s) => (
              <SelectItem key={s.id}>{s.nombre}</SelectItem>
            )) as any
          }
        </Select>
      )}

      {showTrabajadorFilter && (
        <Select
          key={`trabajador-${selectedSucursal || "all"}-${filtrosListTrabajadores.length}`}
          className="min-w-[150px]"
          isDisabled={disableTrabajadorFilter}
          label="Buscar Negocios por Trabajador"
          selectedKeys={
            selectedTrabajador && selectedTrabajador !== "__all__"
              ? new Set([selectedTrabajador])
              : new Set(["__all__"])
          }
          size="lg"
          variant="bordered"
          onSelectionChange={(keys: any) => {
            const first = Array.from(keys || [])?.[0];
            const value =
              first && first !== "__all__" ? String(first) : undefined;

            setFilterTrabajador(value);
          }}
        >
          <SelectItem key="__all__">Todos</SelectItem>
          {filtrosListTrabajadores.length &&
            (filtrosListTrabajadores.map((t) => (
              <SelectItem key={t.email}>{t.nombre}</SelectItem>
            )) as any)}
        </Select>
      )}

      <Input
        className="flex-1 min-w-[200px]"
        label="Buscar negocio"
        placeholder="Buscar negocio por nombre o dirección"
        size="lg"
        value={filter}
        variant="bordered"
        onValueChange={(v) => setFilter(v)}
      />

      {/* Toggle para negocios sin asignar */}
      {(isEmpresaLevel || isSucursalLevel) && (
        <Switch
          classNames={{
            label: "text-sm",
          }}
          isSelected={filterSinAsignar}
          size="sm"
          onValueChange={setFilterSinAsignar}
        >
          Sin asignar
        </Switch>
      )}

      {/* Resumen de filtros aplicados */}
      <div className="flex flex-wrap gap-2 items-center ml-auto">
        <span className="text-sm text-foreground">
          Negocios: {filteredItems.length} de {items.length}
        </span>
        {(!!selectedSucursal ||
          !!selectedTrabajador ||
          !!filter ||
          filterSinAsignar) && (
          <Chip
            className="cursor-pointer"
            size="sm"
            variant="flat"
            onClick={() => {
              setFilter("");
              setFilterSucursal(undefined);
              setFilterTrabajador(undefined);
              setFilterSinAsignar(false);
            }}
            onClose={() => {
              setFilter("");
              setFilterSucursal(undefined);
              setFilterTrabajador(undefined);
              setFilterSinAsignar(false);
            }}
          >
            Limpiar filtros
          </Chip>
        )}
      </div>
    </div>
  );
};

export default NegocioFilter;
