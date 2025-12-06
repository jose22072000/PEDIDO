import { NavigationHeading } from "@/components/navigation-heading";
import CrearPedidoForm from "@/components/pedidos/form";
import { CrearPedidoHeader } from "@/components/pedidos/header";

export default function NuevoPedidoPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-pedidos", label: "Ir a Panel de Pedidos" }}
        paragraph="Complete todos los campos"
        title="Nuevo Pedido"
      />
      <CrearPedidoHeader />
      <CrearPedidoForm />
    </section>
  );
}
