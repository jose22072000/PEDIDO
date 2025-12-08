import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";
import PanelLayout from "@/layouts/panel";

export default function ProtectedRoute() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate replace to="/" />;
  }

  return (
    <PanelLayout>
      <Outlet />
    </PanelLayout>
  );
}
