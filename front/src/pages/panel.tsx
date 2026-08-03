import { NavigationHeading } from "@/components/navigation-heading";
import ActionCard from "@/components/action-card";
import { useDashboard } from "@/providers/DashboardProvider";
import { KPICard } from "@/components/dashboard/KPICard";
import { LineChartCard } from "@/components/dashboard/LineChartCard";
import { useAuthStore } from "@/stores/authStore";
import { useLiveEvents } from "@/hooks/use-live-events";

export default function PanelPage() {
  const { user, session } = useAuthStore();
  const { stats, isLoading, refetch } = useDashboard();
  const sucursalNombre = user?.sucursal || "";
  const isSuperAdmin = Boolean(session?.isGlobalAdmin);

  // RBAC de accesos rápidos: el GESTOR solo ve LO SUYO (pedidos, importar, clientes,
  // su perfil con sus métricas). No ve Vendedores/Usuarios/Reportes (datos ajenos).
  const role = String(user?.role || "").toLowerCase();
  const isGestor = role === "gestor";
  const canVerVendedores = ["administrador", "supervisor", "super admin"].includes(role);
  const canManageUsers = ["administrador", "super admin"].includes(role);

  // El provider ya pide las estadísticas al montarse: volver a pedirlas aquí
  // duplicaba la petición en cada entrada al panel. Con enlaces lentos eso es
  // medio segundo de más por nada.

  // EN VIVO (SSE): las estadísticas se refrescan solas al entrar/completar pedidos.
  // En SEGUNDO PLANO (segundo argumento): los números se sustituyen cuando llegan,
  // sin volver a los skeletons. Antes cada evento dejaba el panel en blanco, y
  // durante una importación eso ocurría decenas de veces por minuto.
  useLiveEvents(["pedido"], () => refetch(undefined, true));

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
            {canVerVendedores && (
              <ActionCard
                color="secondary"
                description="Gestionar vendedores del sistema"
                href="/panel/trabajadores"
                icon="workers"
                title="Vendedores"
              />
            )}
            <ActionCard
              color="secondary"
              description="Gestionar clientes del sistema"
              href="/panel/clientes"
              icon="client"
              title="Clientes"
            />
            {isGestor && (
              <ActionCard
                color="primary"
                description="Tus métricas y tus datos"
                href="/panel/mi-perfil"
                icon="user"
                title="Mi perfil"
              />
            )}
            {canManageUsers && (
              <ActionCard
                color="success"
                description="Gestionar usuarios del sistema"
                href="/panel/panel-usuarios"
                icon="users"
                title="Usuarios"
              />
            )}
            {!isGestor && (
              <ActionCard
                color="danger"
                description="Generar y exportar reportes"
                href="/panel/reportes"
                icon="reports"
                title="Reportes"
              />
            )}
            {isSuperAdmin && (
              <ActionCard
                color="warning"
                description="Sucursales y parámetros del sistema"
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
