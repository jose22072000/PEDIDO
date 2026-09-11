import { BarraSubidas } from "@/components/pedidos/barra-subidas";
import { PageBackground } from "@/components/background";

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col h-screen">
      <PageBackground />
      <main className="container mx-auto max-w-7xl px-6 flex-grow py-10 lg:py-16">
        {children}
      </main>

      {/* Sale sola en CUALQUIER pantalla del panel mientras la cola trabaja, y se va sola
          al terminar. Va aquí y no en la pantalla de pedidos porque quien está facturando
          no va a ir a mirar una pantalla para saber si sus datos están entrando. */}
      <BarraSubidas />
    </div>
  );
}
