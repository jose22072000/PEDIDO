import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";

interface AdminRouteProps {
  allowedRoles?: string[];
}

export default function AdminRoute({
  // El Super Admin está por encima del Administrador: siempre debe pasar.
  allowedRoles = ["Administrador", "Super Admin"],
}: AdminRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  // While loading session, don't redirect — show nothing inside layout
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" />
    );
  }

  if (!isAuthenticated) {
    return <Navigate replace to="/" />;
  }

  /**
   * Los roles GLOBALES pasan siempre, estén o no en la lista de la ruta.
   *
   * Antes había que acordarse de escribir «Super Admin» en cada `allowedRoles`, y con
   * `Desarrollador` —que está por encima— nadie se acordó: ese rol se quedaba fuera de
   * TODAS las rutas y la aplicación se veía vacía. Poniéndolo aquí, una ruta nueva nace
   * bien aunque quien la escriba se olvide.
   */
  const currentRole = user?.role ? String(user.role).toLowerCase() : undefined;
  const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase());
  const hasPermission =
    esRolGlobal(user?.role) || (currentRole ? normalizedAllowed.includes(currentRole) : false);

  if (!hasPermission) {
    return <Navigate replace to="/unauthorized" />;
  }

  return <Outlet />;
}
