import { Card, CardBody, Select, SelectItem } from "@heroui/react";
import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, CartesianGrid } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useDashboard } from "@/providers/DashboardProvider";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const chartConfig = {
  completed: {
    label: "Completados",
    color: "hsl(var(--heroui-success))",
  },
  pending: {
    label: "No Completados",
    color: "hsl(var(--heroui-primary))",
  },
} satisfies ChartConfig;

export function LineChartCard() {
  const { stats, isLoading, selectedYear, setSelectedYear } = useDashboard();
  const { monthlyStats = [], availableYears = [] } = stats || {};

  const displayYear =
    selectedYear?.toString() ||
    availableYears[0]?.toString() ||
    new Date().getFullYear().toString();

  const [activeCharts, setActiveCharts] = useState<
    Set<keyof typeof chartConfig>
  >(new Set());

  const toggleChart = (chart: keyof typeof chartConfig) => {
    setActiveCharts((prev) => {
      const newSet = new Set(prev);

      if (newSet.has(chart)) {
        // Si está activo, lo desactivamos
        newSet.delete(chart);
      } else {
        // Si no está activo, lo activamos y desactivamos el otro
        newSet.clear();
        newSet.add(chart);
      }

      return newSet;
    });
  };

  // Preparar datos del gráfico
  const chartData = useMemo(() => {
    if (!monthlyStats.length) return [];

    const year = parseInt(displayYear);
    const yearStats = monthlyStats.filter((stat) => stat.year === year);

    return MONTHS.map((monthName, index) => {
      const monthStat = yearStats.find((stat) => stat.month === index + 1);
      const total = monthStat?.total || 0;
      const completed = monthStat?.completed || 0;
      const pending = total - completed;

      return {
        month: monthName,
        completed,
        pending,
      };
    });
  }, [displayYear, monthlyStats]);

  // Calcular totales para el año seleccionado
  const total = useMemo(
    () => ({
      completed: chartData.reduce((acc, curr) => acc + curr.completed, 0),
      pending: chartData.reduce((acc, curr) => acc + curr.pending, 0),
    }),
    [chartData],
  );

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardBody className="p-6">
          <div className="h-80 w-full animate-pulse rounded-lg bg-default-200" />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardBody className="p-0">
        {/* Header */}
        <div className="flex flex-col border-b border-divider sm:flex-row">
          {/* Left side - Title and Year Selector */}
          <div className="flex flex-1 flex-col justify-center gap-3 px-6 py-4">
            <div>
              <h3 className="text-lg font-bold">
                Estadísticas de Pedidos Anuales
              </h3>
              <p className="text-sm text-default-500 font-semibold">
                Relación de los pedidos mensualmente
              </p>
            </div>
            <Select
              className="w-full sm:w-40"
              label="Año"
              selectedKeys={[displayYear]}
              size="sm"
              variant="bordered"
              onChange={(e) => {
                const year = parseInt(e.target.value);

                setSelectedYear(year);
              }}
            >
              {availableYears.map((year) => (
                <SelectItem key={year.toString()} textValue={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* Right side - Toggle buttons */}
          <div className="flex lg:min-w-[450px]">
            {(["completed", "pending"] as const).map((key) => {
              const chart = key as keyof typeof chartConfig;

              return (
                <button
                  key={chart}
                  className={cn(
                    "flex flex-1 flex-col justify-center gap-1 border-success px-6 py-4 text-left transition-colors border-l-4 bg-success-50 hover:opacity-70 data-[active=true]:bg-success-100 sm:border-l-4 sm:px-8 sm:py-6",
                    key === "pending" &&
                      "border-primary bg-primary-50 data-[active=true]:bg-primary-100",
                  )}
                  data-active={activeCharts.has(chart)}
                  onClick={() => toggleChart(chart)}
                >
                  <span className="text-default-500 font-bold uppercase text-xs md:text-base">
                    {chartConfig[chart].label}
                  </span>
                  <span className="text-lg font-bold leading-none sm:text-3xl">
                    {total[key].toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart */}
        <div className="w-full overflow-x-auto px-2 sm:px-6 pb-6 pt-4">
          <div style={{ minWidth: "600px" }}>
            <ChartContainer
              className="aspect-auto h-[250px] w-full"
              config={chartConfig}
            >
              <LineChart
                accessibilityLayer
                data={chartData}
                margin={{
                  left: 12,
                  right: 12,
                  top: 20,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="month"
                  tickFormatter={(value) => value.slice(0, 3)}
                  tickLine={false}
                  tickMargin={8}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="w-[150px]"
                      labelFormatter={(value) => value}
                    />
                  }
                />
                {(["completed", "pending"] as const).map((key) => {
                  // Si no hay ninguno activo, mostrar ambos
                  // Si hay uno activo, mostrar solo ese
                  const shouldShow =
                    activeCharts.size === 0 || activeCharts.has(key);

                  if (!shouldShow) return null;

                  return (
                    <Line
                      key={key}
                      activeDot={{
                        r: 6,
                      }}
                      dataKey={key}
                      dot={{
                        fill: chartConfig[key].color,
                        r: 4,
                      }}
                      label={{
                        position: "top",
                        offset: 10,
                        fontSize: 12,
                        fill: "currentColor",
                      }}
                      stroke={chartConfig[key].color}
                      strokeWidth={2}
                      type="monotone"
                    />
                  );
                })}
              </LineChart>
            </ChartContainer>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
