import { NavigationHeading } from "@/components/navigation-heading";
import { UsuariosList } from "@/components/usuarios/usuarios-list";

export default function ListaUsuariosPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-usuarios", label: "Ir a Panel de Usuarios" }}
        icon="user"
        paragraph="Visualiza y gestiona los usuarios del sistema"
        title="Lista de Usuarios"
      />
      <div className="mt-6">
        <UsuariosList />
      </div>
    </section>
  );
}
