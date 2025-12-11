import { NavigationHeading } from "@/components/navigation-heading";
import { VendedoresList } from "@/components/vendedores/vendedores-list";

export default function VendedoresPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="workers"
        paragraph="Visualizar estadísticas de los vendedores"
        title="Vendedores"
      />

      <VendedoresList />
    </section>
  );
}
