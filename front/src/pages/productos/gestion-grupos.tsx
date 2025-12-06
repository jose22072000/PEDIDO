import { NavigationHeading } from "@/components/navigation-heading";
import GruposList from "@/components/grupo/ListarGrupo";

export default function GruposProductosPage() {
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
        icon="tag"
        paragraph="Lista y administra los grupos usados por los productos."
        title="Gestión de Grupos"
      />

      <div className="w-full space-y-6">
        <GruposList
          className="container mx-auto"
          onSelect={handleSelectGroup}
        />
      </div>
    </section>
  );
}
