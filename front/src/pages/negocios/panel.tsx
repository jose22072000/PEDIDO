import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function NegociosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="store"
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Panel de Negocios"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="primary"
          description="Registrar un nuevo negocio"
          href="/panel/panel-negocio/nuevo"
          icon="add"
          title="Nuevo Negocio"
        />
        <ActionCard
          color="primary"
          description="Visualizar negocios asignados"
          href="/panel/panel-negocio/asignados"
          icon="store"
          title="Negocios Asignados"
        />
        <ActionCard
          color="primary"
          description="Visualizar negocios de la sucursal"
          href="/panel/panel-negocio/sucursal"
          icon="store"
          title="Negocios de la Sucursal"
        />
        <ActionCard
          color="primary"
          description="Visualizar negocios de la empresa"
          href="/panel/panel-negocio/empresa"
          icon="store"
          title="Negocios de la Empresa"
        />
        <ActionCard
          color="primary"
          description="Visualizar reportes de negocios"
          href="/panel/panel-negocio/reportes"
          icon="reports"
          title="Reportes de Negocios"
        />
      </div>
    </section>
  );
}
