import { NavigationHeading } from "@/components/navigation-heading";
import { OrdersList } from "@/components/pedidos/order-list";

export default function PedidoExpiradosPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-pedidos", label: "Ir a Panel de Pedidos" }}
        icon="receipt"
        paragraph="Filtrar y gestionar pedidos expirados"
        title="Pedidos Expirados"
      />
      <div className="mt-6">
        <OrdersList estado="expirada" />
      </div>
    </section>
  );
}
