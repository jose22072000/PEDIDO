import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function ContactosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Panel de Contactos"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="primary"
          description="Iniciar un nuevo contacto"
          href="/panel/panel-contactos/nuevo"
          icon="add"
          title="Nuevo Contacto"
        />
        <ActionCard
          color="primary"
          description="Visualizar mis contactos"
          href="/panel/panel-contactos/mios"
          icon="contact"
          title="Mis Contactos"
        />
        <ActionCard
          color="primary"
          description="Visualizar contactos de la sucursal"
          href="/panel/panel-contactos/sucursal"
          icon="contact"
          title="Contactos de la Sucursal"
        />
        <ActionCard
          color="primary"
          description="Visualizar contactos de la empresa"
          href="/panel/panel-contactos/empresa"
          icon="contact"
          title="Contactos de la Empresa"
        />
        <ActionCard
          color="primary"
          description="Visualizar reportes de contactos de la empresa o sucursal."
          href="/panel/panel-contactos/reportes"
          icon="reports"
          title="Reportes de Contactos"
        />
      </div>
    </section>
  );
}
