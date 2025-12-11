import { createContext, useContext, useEffect, useState } from "react";

import { API_BASE_URL } from "@/config";

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
  refetch: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined,
);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/orders/stats`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Error al cargar estadísticas");
      }

      const data = await response.json();

      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    // Actualizar cada 15 minutos (900000 ms)
    const interval = setInterval(fetchStats, 900000);

    return () => clearInterval(interval);
  }, []);

  return (
    <DashboardContext.Provider
      value={{ stats, isLoading, error, refetch: fetchStats }}
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
