import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";

export function useAuthGuard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, isLoading, navigate]);

  return { isAuthenticated, isLoading };
}
