import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function SucursalesPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="building"
        paragraph="Gestiona las sucursales de la empresa"
        title="Panel de Sucursales"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="warning"
          description="Registrar una nueva sucursal"
          href="/panel/panel-sucursal/nuevo"
          icon="add"
          title="Nueva Sucursal"
        />
        <ActionCard
          color="warning"
          description="Ver detalles de sucursales"
          href="/panel/panel-sucursal/visualizar"
          icon="eye"
          title="Visualizar Sucursales"
        />
        <ActionCard
          color="warning"
          description="Generar reportes de sucursales"
          href="/panel/panel-sucursal/reportes"
          icon="reports"
          title="Reportes"
        />
      </div>
    </section>
  );
}
