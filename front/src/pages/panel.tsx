import { useEffect } from "react";

import { useSyncStore } from "@/stores/syncStore";
import { NavigationHeading } from "@/components/navigation-heading";
import ActionCard from "@/components/action-card";

export default function PanelPage() {
  const { updateStats } = useSyncStore();

  useEffect(() => {
    updateStats();
  }, [updateStats]);

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{ href: "/", label: "Ir al Inicio" }}
        paragraph="Visualiza todas las acciones a realizar en el sistema."
        title="Panel de Control"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <ActionCard
          color="primary"
          description="Ver y gestionar los pedidos"
          href="/panel/panel-pedidos"
          icon="pedido"
          title="Pedidos"
        />
        <ActionCard
          color="primary"
          description="Gestionar vendedores del sistema"
          href="/panel/trabajadores"
          icon="workers"
          title="Vendedores"
        />
        <ActionCard
          color="primary"
          description="Gestionar los usuarios del sistema"
          href="/panel/clientes"
          icon="partners"
          title="Usuarios"
        />
      </div>
      {/* TODO CHART & COUNT */}
    </section>
  );
}
