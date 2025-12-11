import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";
import PanelLayout from "@/layouts/panel";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  // While the auth session is being loaded, show a neutral loading view
  if (isLoading) {
    return (
      <PanelLayout>
        <div className="flex items-center justify-center min-h-screen" />
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
