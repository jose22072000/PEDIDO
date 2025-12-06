import { useEffect } from "react";

import { PageBackground } from "@/components/background";
import { useSyncStore } from "@/stores/syncStore";
import {
  useProductoStore,
  useProveedorStore,
  useCategoriaStore,
  useGrupoStore,
  useSucursalStore,
  useVentaStore,
  usePedidoStore,
  useDetallePedidoStore,
  useVisitaStore,
  useTrabajadorStore,
  useNegocioStore,
  useContactoStore,
} from "@/stores/entityStores";

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { startSync, updateStats } = useSyncStore();

  // Cargar todos los datos de IndexedDB al montar
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Cargar todas las entidades desde IndexedDB
        await Promise.all([
          useProductoStore.getState().loadAll(),
          useProveedorStore.getState().loadAll(),
          useCategoriaStore.getState().loadAll(),
          useGrupoStore.getState().loadAll(),
          useSucursalStore.getState().loadAll(),
          useVentaStore.getState().loadAll(),
          usePedidoStore.getState().loadAll(),
          useDetallePedidoStore.getState().loadAll(),
          useVisitaStore.getState().loadAll(),
          useTrabajadorStore.getState().loadAll(),
          useNegocioStore.getState().loadAll(),
          useContactoStore.getState().loadAll(),
        ]);

        // Actualizar estadísticas de sincronización
        await updateStats();

        // Iniciar sincronización si está online
        await startSync();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error loading initial data:", error);
      }
    };

    loadAllData();
  }, [startSync, updateStats]);

  return (
    <div className="relative flex flex-col h-screen">
      <PageBackground />
      <main className="container mx-auto max-w-7xl px-6 flex-grow py-10 lg:py-16">
        {children}
      </main>
    </div>
  );
}
