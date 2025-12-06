import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Spinner } from "@heroui/react";

import { useAuthStore } from "@/stores/authStore";
import PanelLayout from "@/layouts/panel";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  React.useEffect(() => {
    useAuthStore.getState().loadSession();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner color="warning" size="lg" />
      </div>
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
