import { useEffect } from "react";

import { NavigationHeading } from "@/components/navigation-heading";
import ActionCard from "@/components/action-card";
import { useDashboard } from "@/providers/DashboardProvider";
import { KPICard } from "@/components/dashboard/KPICard";
import { LineChartCard } from "@/components/dashboard/LineChartCard";
import { useAuthStore } from "@/stores/authStore";

export default function PanelPage() {
  const { user } = useAuthStore();
  const { stats, isLoading, refetch } = useDashboard();
  const sucursalNombre = user?.sucursal || "";
  const isAdmin = String(user?.role || "").toLowerCase() === "administrador";

  useEffect(() => {
    // Refetch stats cada vez que se entre a la página
    refetch();
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{ href: "/", label: "Ir al Inicio" }}
        icon="locales"
        paragraph="Visualiza todas las acciones a realizar en el sistema."
        title={
          sucursalNombre
            ? `Sucursal ${sucursalNombre} - Panel de Control`
            : "Panel de Control"
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="col-span-1 lg:col-span-4">
          <h2 className="text-xl font-semibold mb-6">Acceso Rápido</h2>
          <div className="flex flex-col gap-6">
            <ActionCard
              color="primary"
              description="Ver y gestionar los pedidos"
              href="/panel/panel-pedidos"
              icon="pedido"
              title="Pedidos"
            />
            <ActionCard
              color="primary"
              description="Archivo csv de parranda"
              href="/panel/panel-pedidos/nuevo"
              icon="add"
              title="Importar Pedido"
            />
            <ActionCard
              color="secondary"
              description="Gestionar vendedores del sistema"
              href="/panel/trabajadores"
              icon="workers"
              title="Vendedores"
            />
            <ActionCard
              color="secondary"
              description="Gestionar clientes del sistema"
              href="/panel/clientes"
              icon="client"
              title="Clientes"
            />
            <ActionCard
              color="success"
              description="Gestionar usuarios del sistema"
              href="/panel/panel-usuarios"
              icon="users"
              title="Usuarios"
            />
            <ActionCard
              color="danger"
              description="Generar y exportar reportes"
              href="/panel/reportes"
              icon="reports"
              title="Reportes"
            />
            {isAdmin && (
              <ActionCard
                color="warning"
                description="Configurar parámetros del sistema"
                href="/panel/configuracion"
                icon="configuracion"
                title="Configuración"
              />
            )}
          </div>
        </div>
        <div className="col-span-1 lg:col-span-8">
          <h2 className="text-xl font-semibold mb-6">Estadísticas</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <KPICard
              color="primary"
              isLoading={isLoading}
              title="Total de Pedidos"
              value={stats?.totalPedidos || 0}
            />
            <KPICard
              color="success"
              isLoading={isLoading}
              title="Completados"
              value={stats?.pedidosCompletados || 0}
            />
            <KPICard
              color="warning"
              isLoading={isLoading}
              title="En Proceso"
              value={stats?.pedidosEnProceso || 0}
            />
            <KPICard
              color="danger"
              isLoading={isLoading}
              title="Expirados"
              value={stats?.pedidosExpirados || 0}
            />
          </div>
          <LineChartCard />
        </div>
      </div>
    </section>
  );
}
