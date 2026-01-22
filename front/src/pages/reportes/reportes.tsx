import { NavigationHeading } from "@/components/navigation-heading";
import ActionCard from "@/components/action-card";

export default function ReportesPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="reports"
        paragraph="Genera y exporta reportes detallados de tus pedidos"
        title="Centro de Reportes"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <ActionCard
          color="primary"
          description="Consulta todos los pedidos en un rango de fechas"
          href="/panel/reportes/pedidos-fecha"
          icon="calendar"
          title="Pedidos por Fecha"
        />
        <ActionCard
          color="secondary"
          description="Analiza el rendimiento de cada vendedor por fecha"
          href="/panel/reportes/pedidos-vendedor"
          icon="workers"
          title="Pedidos por Vendedor"
        />
        <ActionCard
          color="success"
          description="Filtra pedidos por estado, vendedor y fecha"
          href="/panel/reportes/pedidos-estado"
          icon="check"
          title="Pedidos por Estado"
        />
        <ActionCard
          color="warning"
          description="Analiza sumas totales por tipo de producto y vendedor"
          href="/panel/reportes/productos-vendedor"
          icon="productos"
          title="Productos por Vendedor"
        />
      </div>
    </section>
  );
}
