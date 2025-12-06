import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function ProductosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="productos"
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Panel de Productos"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="primary"
          description="Visualizar catálogo de productos"
          href="/panel/panel-productos/catalogo"
          icon="catalogo"
          title="Catalogo"
        />
        <ActionCard
          color="primary"
          description="Control y administración de productos"
          href="/panel/panel-productos/gestion-productos"
          icon="product"
          title="Gestionar Productos"
        />
        <ActionCard
          color="primary"
          description="Control y administración grupos de productos"
          href="/panel/panel-productos/gestion-grupos"
          icon="tag"
          title="Gestionar Grupos"
        />
        <ActionCard
          color="primary"
          description="Control y administración de proveedores"
          href="/panel/panel-productos/gestion-proveedores"
          icon="partners"
          title="Gestionar Proveedores"
        />
      </div>
    </section>
  );
}
