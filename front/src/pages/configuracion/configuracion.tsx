import { NavigationHeading } from "@/components/navigation-heading";
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form";

export default function ConfiguracionPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="configuracion"
        paragraph="Configura los parámetros del sistema"
        title="Configuración del Sistema"
      />
      <div className="mt-6">
        <ConfiguracionForm />
      </div>
    </section>
  );
}
