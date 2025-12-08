import { NavigationHeading } from "@/components/navigation-heading";
import CrearPedidoForm from "@/components/pedidos/form";


export default function NuevoPedidoPage() {
  return (
    <section>
      <NavigationHeading
        cta={{ href: "/panel/panel-pedidos", label: "Ir a Panel de Pedidos" }}
        paragraph="Suba el fichero o los ficheros "
        title="Importar Pedido"
      />
      <CrearPedidoForm />
    </section>
  );
}
