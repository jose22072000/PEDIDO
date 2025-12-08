import { NavigationHeading } from "@/components/navigation-heading";
import { OrdersList } from "@/components/pedidos/order-list";

export default function PedidoCompletadoPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-pedidos", label: "Ir a Panel de Pedidos" }}
        icon="receipt"
        paragraph="Filtrar y gestionar pedidos completados"
        title="Pedidos Completados"
      />
      <div className="mt-6">
        <OrdersList estado="completada" />
      </div>
    </section>
  );
}
