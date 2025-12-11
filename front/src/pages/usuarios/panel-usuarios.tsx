import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function UsuariosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="user"
        paragraph="Gestiona usuarios del sistema"
        title="Gestión de Usuarios"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="primary"
          description="Ver todos los usuarios del sistema"
          href="/panel/panel-usuarios/lista"
          icon="user"
          title="Lista de Usuarios"
        />
        <ActionCard
          color="success"
          description="Crear un nuevo usuario en el sistema"
          href="/panel/panel-usuarios/nuevo"
          icon="add"
          title="Crear Usuario"
        />
      </div>
    </section>
  );
}
