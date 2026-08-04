import { Spinner } from "@heroui/react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";
import PanelLayout from "@/layouts/panel";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  // Mientras se comprueba la sesion se DICE que se esta comprobando. Antes se
  // pintaba un div vacio: una pantalla en blanco, sin texto ni spinner, que no
  // se distingue de la aplicacion rota. Quien la veia no sabia si era su
  // internet, si cargaba, o si el sistema se habia caido.
  if (isLoading) {
    return (
      <PanelLayout>
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Spinner color="primary" size="lg" />
          <p className="text-sm text-default-500">Comprobando la sesión…</p>
        </div>
      </PanelLayout>
    );
  }

  if (!isAuthenticated) {
    return <Navigate replace to="/" />;
  }

  return (
    <PanelLayout>
      <Outlet />
    </PanelLayout>
  );
}
