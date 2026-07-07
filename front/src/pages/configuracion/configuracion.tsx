import { NavigationHeading } from "@/components/navigation-heading";
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form";

export default function ConfiguracionPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="configuracion"
        paragraph="Opciones sensibles de administracion del sistema"
        title="Configuracion de Administrador"
      />
      <div className="mt-6">
        <ConfiguracionForm />
      </div>
    </section>
  );
}
