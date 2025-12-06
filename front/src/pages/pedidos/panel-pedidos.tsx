import ActionCard from "@/components/action-card";
import { NavigationHeading } from "@/components/navigation-heading";

export default function PedidosPanelPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        paragraph="Visualiza todas las acciones a realizar en este panel"
        title="Gestión de Pedidos"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ActionCard
          color="primary"
          description="Importar pedidos desde archivo csv"
          href="/panel/panel-pedidos/nuevo"
          icon="add"
          title="Importar Pedido"
        />
        <ActionCard
          color="primary"
          description="Visualizar mis pedidos"
          href="/panel/panel-pedidos/mios"
          icon="pedido"
          title="Mis Pedidos"
        />
        <ActionCard
          color="primary"
          description="Visualizar pedidos de la sucursal"
          href="/panel/panel-pedidos/sucursal"
          icon="pedido"
          title="Pedidos de la Sucursal"
        />
        <ActionCard
          color="primary"
          description="Visualizar pedidos de la empresa"
          href="/panel/panel-pedidos/empresa"
          icon="pedido"
          title="Pedidos de la Empresa"
        />
        <ActionCard
          color="primary"
          description="Visualizar reportes de pedidos"
          href="/panel/panel-pedidos/reportes"
          icon="reports"
          title="Reportes"
        />
      </div>
    </section>
  );
}
