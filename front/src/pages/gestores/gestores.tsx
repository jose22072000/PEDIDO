import { NavigationHeading } from "@/components/navigation-heading";
import { GestoresList } from "@/components/gestores/gestores-list";

export default function GestoresPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="partners"
        paragraph="Enlazar cada vendedor con su gestor. La sucursal del pedido se toma del gestor."
        title="Gestores"
      />

      <GestoresList />
    </section>
  );
}
