import { Card, CardBody, Select, SelectItem, Skeleton } from "@heroui/react";
import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";

interface MonthlyStats {
  year: number;
  month: number;
  total: number;
  completed: number;
}

interface ChartCardProps {
  monthlyStats: MonthlyStats[];
  availableYears: number[];
  isLoading?: boolean;
}

const MONTHS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const chartConfig = {
  total: {
    label: "Total Pedidos",
    color: "hsl(212, 100%, 47%)",
  },
  pending: {
    label: "No Completados",
    color: "hsl(24, 95%, 53%)",
  },
  completed: {
    label: "Completados",
    color: "hsl(142, 71%, 45%)",
  },
};

export function ChartCard({
  monthlyStats,
  availableYears,
  isLoading = false,
}: ChartCardProps) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(
    currentYear.toString(),
  );

  const chartData = useMemo(() => {
    const year = parseInt(selectedYear);
    const yearStats = monthlyStats.filter((stat) => stat.year === year);

    // Crear datos para todos los 12 meses
    return MONTHS.map((monthName, index) => {
      const monthStat = yearStats.find((stat) => stat.month === index + 1);
      const total = monthStat?.total || 0;
      const completed = monthStat?.completed || 0;
      const pending = total - completed;

      return {
        month: monthName,
        completed,
        pending,
        total,
      };
    });
  }, [selectedYear, monthlyStats]);

  // Calcular totales para el año seleccionado
  const yearTotals = useMemo(() => {
    const totals = chartData.reduce(
      (acc, month) => ({
        completed: acc.completed + month.completed,
        pending: acc.pending + month.pending,
        total: acc.total + month.total,
      }),
      { completed: 0, pending: 0, total: 0 },
    );

    return totals;
  }, [chartData]);

  return (
    <Card className="w-full">
      <CardBody className="p-6">
        {/* Header with Title and Year Selector */}
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">
              Gráfico de Barras - Interactivo
            </h3>
            <p className="text-sm text-default-500">
              Mostrando pedidos totales de los últimos 12 meses
            </p>
          </div>
          {isLoading ? (
            <Skeleton className="w-32 rounded-lg">
              <div className="h-10 w-full rounded-lg bg-default-200" />
            </Skeleton>
          ) : (
            <Select
              className="w-full md:w-32"
              label="Año"
              selectedKeys={[selectedYear]}
              size="sm"
              variant="bordered"
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {availableYears.map((year) => (
                <SelectItem key={year.toString()} textValue={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </Select>
          )}
        </div>

        {/* KPIs */}
        {!isLoading && (
          <div className="flex gap-8 mb-6">
            <div className="flex flex-col">
              <span className="text-sm text-default-500">Completados</span>
              <span className="text-2xl font-bold">
                {yearTotals.completed.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-default-500">No Completados</span>
              <span className="text-2xl font-bold">
                {yearTotals.pending.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* Chart - Scrollable Wrapper */}
        {isLoading ? (
          <Skeleton className="w-full rounded-lg">
            <div className="h-80 w-full rounded-lg bg-default-200" />
          </Skeleton>
        ) : (
          <div className="w-full overflow-x-auto">
            <div style={{ minWidth: "600px" }}>
              <ChartContainer config={chartConfig}>
                <BarChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ left: 12, right: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="month"
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis axisLine={false} tickLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="completed"
                    fill="var(--color-completed)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="pending"
                    fill="var(--color-pending)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
