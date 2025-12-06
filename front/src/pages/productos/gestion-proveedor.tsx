import { NavigationHeading } from "@/components/navigation-heading";
import ListarProvedores from "@/components/Provedores/ListarProvedores";

export default function ProveedoresProductosPage() {
  const handleSelectGroup = (id?: string) => {
    if (!id) return;
    // navegar o setear estado global cuando se necesite
  };

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{
          href: "/panel/panel-productos",
          label: "Ir a Panel de Productos",
        }}
        icon="partners"
        paragraph="Lista y administra los Provedores usados por los productos."
        title="Gestión de Provedores"
      />

      <div className="w-full space-y-6">
        <ListarProvedores
          className="container mx-auto"
          onSelect={handleSelectGroup}
        />
      </div>
    </section>
  );
}
