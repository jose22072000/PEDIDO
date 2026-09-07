import { NavigationHeading } from "@/components/navigation-heading";
import { ClientesParrandaPanel } from "@/components/sincronizacion/clientes-parranda-panel";

/**
 * El sincronizador de CLIENTES (Parranda), en su propia pantalla.
 *
 * # Por qué salió de Configuración
 *
 * Estaba metido al final de la página de Configuración, entre los parámetros del sistema y
 * la zona de peligro. Configuración es donde se **ajustan** cosas; esto es donde se
 * **comprueba** que algo corre —el resumen por sucursal, el historial del cron de las 6 de
 * la tarde, y el botón de sincronizar a mano—. Mezclarlos hacía que para mirar si la
 * sincronización de anoche había ido bien hubiera que entrar en la pantalla donde también
 * está el botón de borrar la base.
 *
 * Ahora son dos vistas hermanas con su propia ruta y su propio botón en el panel: ésta y
 * la de facturación.
 *
 * El componente no se tocó al mudarlo. Sigue haciendo exactamente lo mismo.
 */
export default function SincronizacionClientesPage() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        // A Configuración, que es de donde se entra. Al panel es un salto de más:
        // hay que volver a bajar hasta el bloque de sincronizadores para seguir.
        cta={{ href: "/panel/configuracion", label: "Volver a Configuración" }}
        icon="client"
        paragraph="Los clientes que vienen de Parranda: cuántos hay por sucursal, cuándo se sincronizó por última vez y cómo fue. Se sincroniza solo a las 6 de la tarde."
        title="Sincronización · Clientes"
      />
      <ClientesParrandaPanel />
    </section>
  );
}
