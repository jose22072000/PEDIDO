import { NavigationHeading } from "@/components/navigation-heading";
import { OrdersList } from "@/components/pedidos/order-list";

export default function PedidoProcesoPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-pedidos", label: "Ir a Panel de Pedidos" }}
        icon="receipt"
        paragraph="Filtrar y gestionar pedidos en proceso"
        title="Pedidos en Proceso"
      />
      <div className="mt-6">
        <OrdersList estado="en_proceso" />
      </div>
    </section>
  );
}
