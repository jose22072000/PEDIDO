import { NavigationHeading } from "@/components/navigation-heading";
import { RepartoSyncPanel } from "@/components/sincronizacion/reparto-panel";

/**
 * Las dos direcciones entre PEDIDO y el reparto, en su propia pantalla.
 *
 * Hermana de las de Entrega, Clientes y Facturación: es para COMPROBAR que algo corre.
 * Aquí hay dos caminos y hasta ahora ninguno se veía — el reparto preguntaba cada minuto
 * y nadie sabía si le llegaba.
 */
export default function SincronizacionRepartoPage() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        cta={{ href: "/panel/configuracion", label: "Volver a Configuración" }}
        icon="reports"
        paragraph="Lo que PEDIDO le avisa al reparto cuando un pedido ya se puede repartir, y lo que el reparto escribe de vuelta con el estado de cada entrega. Se refresca solo cada 30 segundos."
        title="Sincronización · Reparto"
      />
      <RepartoSyncPanel />
    </section>
  );
}
