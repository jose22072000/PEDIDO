import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";

interface AdminRouteProps {
  allowedRoles?: string[];
}

export default function AdminRoute({
  allowedRoles = ["Administrador"],
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

  // Verificar si el usuario tiene el rol permitido
  const currentRole = user?.role ? String(user.role).toLowerCase() : undefined;
  const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase());
  const hasPermission = currentRole ? normalizedAllowed.includes(currentRole) : false;

  if (!hasPermission) {
    return <Navigate replace to="/unauthorized" />;
  }

  return <Outlet />;
}
