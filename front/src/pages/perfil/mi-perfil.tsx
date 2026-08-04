import { useEffect, useState } from "react";

import { NavigationHeading } from "@/components/navigation-heading";
import { KPICard } from "@/components/dashboard/KPICard";
import { useAuthStore } from "@/stores/authStore";
import { getApiBaseUrl } from "@/config";
import { useLiveEvents } from "@/hooks/use-live-events";
import { mostrarUsuario } from "@/lib/nombre-usuario";

type Stats = {
  totalPedidos: number;
  pedidosCompletados: number;
  pedidosEnProceso: number;
  pedidosExpirados: number;
};

/**
 * Mi perfil: quién eres + TUS métricas. El backend scopea /orders/stats al gestor
 * (solo pedidos de SUS vendedores), así el vendedor revisa lo suyo desde aquí sin
 * entrar a la vista de Vendedores ni ver métricas ajenas.
 */
export default function MiPerfilPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/orders/stats`);

      if (r.ok) setStats(await r.json());
    } catch {
      // ignorar: enlace flaky; se reintenta al volver a entrar o por SSE
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // En vivo: al entrar/completar pedidos, las métricas se refrescan solas.
  useLiveEvents(["pedido"], () => fetchStats());

  const username = mostrarUsuario(user?.username) || "";
  const rol = user?.role || "";
  const sucursal = user?.sucursal || "";

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir al Panel" }}
        icon="user"
        paragraph="Tu cuenta y tus métricas."
        title="Mi perfil"
      />

      <div className="rounded-2xl border border-default-200 bg-content1 p-6 flex flex-col gap-1">
        <div className="text-sm text-default-500">Conectado como</div>
        <div className="text-2xl font-bold text-primary">{username}</div>
        <div className="flex flex-wrap gap-4 text-sm text-default-600 mt-1">
          {rol ? (
            <span>
              Rol: <b>{rol}</b>
            </span>
          ) : null}
          {sucursal ? (
            <span>
              Sucursal: <b>{sucursal}</b>
            </span>
          ) : null}
        </div>
      </div>

      <h2 className="text-xl font-semibold mt-2">Mis métricas</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <KPICard
          color="primary"
          isLoading={loading}
          title="Total de Pedidos"
          value={stats?.totalPedidos || 0}
        />
        <KPICard
          color="success"
          isLoading={loading}
          title="Completados"
          value={stats?.pedidosCompletados || 0}
        />
        <KPICard
          color="warning"
          isLoading={loading}
          title="En Proceso"
          value={stats?.pedidosEnProceso || 0}
        />
        <KPICard
          color="danger"
          isLoading={loading}
          title="Expirados"
          value={stats?.pedidosExpirados || 0}
        />
      </div>
    </section>
  );
}
