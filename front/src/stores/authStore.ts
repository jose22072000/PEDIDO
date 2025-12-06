import { create } from "zustand";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8400";

interface UserData {
  id: string;
  username: string;
  role?: string;
  sucursal?: string;
}

interface AuthState {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSession: () => Promise<void>;
  clearSession: () => Promise<void>;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<{ ok: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  loadSession: async () => {
    try {
      set({ isLoading: true });
      
      // Verificar si hay sesión válida consultando /auth/me
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        credentials: "include", // Incluir cookies
      });

      if (response.ok) {
        const data = await response.json();
        set({
          user: data.user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      }
    } catch (error) {
      set({
        user: null,
        isAuthenticated: false,
        error: error instanceof Error ? error.message : "Error loading session",
        isLoading: false,
      });
    }
  },

  clearSession: async () => {
    set({ user: null, isAuthenticated: false, error: null });
  },

  login: async (username: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Incluir cookies
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        return { ok: false, error: data.error || "Error al iniciar sesión" };
      }

      const data = await response.json();
      set({
        user: data.user,
        isAuthenticated: true,
        error: null,
      });

      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Error de conexión" };
    }
  },

  logout: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include", // Incluir cookies
      });

      if (response.ok) {
        set({ user: null, isAuthenticated: false, error: null });
        return { ok: true };
      }

      return { ok: false, error: "Error al cerrar sesión" };
    } catch (error) {
      return { ok: false, error: "Error de conexión" };
    }
  },
}));
