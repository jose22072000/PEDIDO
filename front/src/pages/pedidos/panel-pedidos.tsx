import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function PedidosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="pedido"
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Gestión de Pedidos"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="warning"
          description="Filtrar y gestionar pedidos en proceso"
          href="/panel/panel-pedidos/pedido-proceso"
          icon="pedido"
          title="Pedidos en Proceso"
        />
        <ActionCard
          color="primary"
          description="Importar pedidos desde archivo csv"
          href="/panel/panel-pedidos/nuevo"
          icon="add"
          title="Importar Pedido"
        />

        <ActionCard
          color="success"
          description="Filtrar y visualizar pedidos completados"
          href="/panel/panel-pedidos/pedido-completados"
          icon="pedido"
          title="Pedidos Completados"
        />
        <ActionCard
          color="danger"
          description="Filtrar y visualizar pedidos expirados"
          href="/panel/panel-pedidos/pedido-expirados"
          icon="pedido"
          title="Pedidos Expirados"
        />
      </div>
    </section>
  );
}
