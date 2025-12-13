import { createContext, useContext, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

interface MonthlyStats {
  year: number;
  month: number;
  total: number;
  completed: number;
}

interface DashboardStats {
  totalPedidos: number;
  pedidosCompletados: number;
  pedidosEnProceso: number;
  pedidosExpirados: number;
  monthlyStats: MonthlyStats[];
  availableYears: number[];
}

interface DashboardContextType {
  stats: DashboardStats | null;
  isLoading: boolean;
  error: string | null;
  selectedYear: number | null;
  setSelectedYear: (year: number) => void;
  refetch: (year?: number) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined,
);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const fetchStats = async (year?: number) => {
    try {
      setIsLoading(true);
      setError(null);

      const yearParam = year ?? selectedYear;
      const url = yearParam
        ? `${getApiBaseUrl()}/orders/stats?year=${yearParam}`
        : `${getApiBaseUrl()}/orders/stats`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Error al cargar estadísticas");
      }

      const data = await response.json();

      setStats(data);

      // Si es la primera carga y no hay año seleccionado, usar el año actual
      if (!selectedYear && data.availableYears?.length > 0) {
        const currentYear = new Date().getFullYear();
        // Usar el año actual si está en los años disponibles, sino usar el primero
        const defaultYear = data.availableYears.includes(currentYear)
          ? currentYear
          : data.availableYears[0];

        setSelectedYear(defaultYear);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    // Actualizar cada 15 minutos (900000 ms)
    const interval = setInterval(() => fetchStats(), 900000);

    return () => clearInterval(interval);
  }, []);

  // Refetch cuando cambia el año seleccionado
  useEffect(() => {
    if (selectedYear !== null) {
      fetchStats(selectedYear);
    }
  }, [selectedYear]);

  return (
    <DashboardContext.Provider
      value={{
        stats,
        isLoading,
        error,
        selectedYear,
        setSelectedYear,
        refetch: fetchStats,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);

  if (context === undefined) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }

  return context;
}
