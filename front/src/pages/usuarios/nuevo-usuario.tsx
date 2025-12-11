import { NavigationHeading } from "@/components/navigation-heading";
import { NuevoUsuarioForm } from "@/components/usuarios/nuevo-usuario-form";

export default function NuevoUsuarioPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-usuarios", label: "Ir a Panel de Usuarios" }}
        icon="user"
        paragraph="Completa el formulario para crear un nuevo usuario"
        title="Crear Nuevo Usuario"
      />
      <div className="mt-6">
        <NuevoUsuarioForm />
      </div>
    </section>
  );
}
