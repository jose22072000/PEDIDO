import { ClientesList } from "@/components/clientes/clientes-list";
import { NavigationHeading } from "@/components/navigation-heading";

export default function ClientesPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="client"
        paragraph="Visualizar los clientes de la subursal"
        title="Clientes"
      />

      <ClientesList />
    </section>
  );
}
