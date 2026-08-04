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
  /** `fondo: true` recarga en silencio, sin mostrar skeletons ni errores. */
  refetch: (year?: number, fondo?: boolean) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined,
);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  /**
   * @param year   año a consultar
   * @param fondo  true = recarga silenciosa (evento SSE, temporizador). NO enciende
   *               el estado de carga, así la pantalla no vuelve a los skeletons ni
   *               parpadea: los datos se sustituyen cuando llegan y ya.
   *               Con conexiones lentas la diferencia es enorme, porque cada
   *               recarga tardaba segundos con el panel en blanco.
   */
  const fetchStats = async (year?: number, fondo = false) => {
    try {
      if (!fondo) setIsLoading(true);
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
      // Una recarga de fondo que falla no debe pintar un error en pantalla: los
      // datos que ya se ven siguen siendo válidos y lo intentará de nuevo.
      if (!fondo) setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (!fondo) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    // NO hay refresco periódico. Antes había uno cada 15 minutos "por si acaso",
    // pero eso es polling: pedir por si algo cambió. Para eso está el SSE, que
    // avisa cuando cambia de verdad — y si la conexión se cae, el hook la
    // reabre solo. Un temporizador encima solo añade peticiones que no hacen
    // falta y que en enlaces lentos se notan.
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
