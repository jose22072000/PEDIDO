import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";

export function useAuthGuard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, loadSession, checkSession } =
    useAuthStore();

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!checkSession()) {
        navigate("/");
      }
    }, 60000); // Verificar cada minuto

    return () => clearInterval(interval);
  }, [checkSession, navigate]);

  return { isAuthenticated, isLoading };
}
