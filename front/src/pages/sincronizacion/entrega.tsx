import { NavigationHeading } from "@/components/navigation-heading";
import { EntregaEnviosPanel } from "@/components/sincronizacion/entrega-envios-panel";

/**
 * Lo que manda la APK de Entrega, en su propia pantalla.
 *
 * Hermana de las de Clientes y Facturación: las tres son para COMPROBAR que algo corre, no
 * para ajustar nada. Ésta responde sin preguntarle a nadie las tres cosas que se repetían:
 * qué folios se están rechazando, por qué, y si el pedido existe o falta subirlo.
 */
export default function SincronizacionEntregaPage() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        cta={{ href: "/panel/configuracion", label: "Volver a Configuración" }}
        icon="reports"
        paragraph="Cada folio que la APK de Entrega intenta cobrar, con el motivo por el que entra o no, cuántas veces lo ha reintentado y qué tenemos nosotros de ese folio. Se refresca solo cada minuto."
        title="Sincronización · Envíos de Entrega"
      />
      <EntregaEnviosPanel />
    </section>
  );
}
