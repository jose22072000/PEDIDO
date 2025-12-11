import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";

interface AdminRouteProps {
  allowedRoles?: string[];
}

export default function AdminRoute({
  allowedRoles = ["admin"],
}: AdminRouteProps) {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate replace to="/" />;
  }

  // Verificar si el usuario tiene el rol permitido
  const hasPermission =
    user?.role && allowedRoles.includes(user.role.toLowerCase());

  if (!hasPermission) {
    return <Navigate replace to="/unauthorized" />;
  }

  return <Outlet />;
}
