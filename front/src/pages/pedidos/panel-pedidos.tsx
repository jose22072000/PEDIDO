import { NavigationHeading } from "@/components/navigation-heading";
import { OrdersList } from "@/components/pedidos/order-list";

export default function PedidosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="pedido"
        paragraph="Gestiona y filtra todos tus pedidos desde un solo lugar"
        title="Gestión de Pedidos"
      />

      <OrdersList />
    </section>
  );
}
