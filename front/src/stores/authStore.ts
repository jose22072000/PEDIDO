import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getApiBaseUrl } from "@/config";

interface UserData {
  id: string;
  username: string;
  role?: string;
  sucursal?: string;
}

interface AuthState {
  user: UserData | null;
  token?: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  // derived session fields for convenience (used across UI)
  session?: {
    rol?: string;
    sucursalId?: string;
    usuarioId?: string;
  } | null;

  // Actions
  loadSession: () => Promise<void>;
  clearSession: () => Promise<void>;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<{ ok: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      session: null,

      loadSession: async () => {
        try {
          set({ isLoading: true });

          // Verificar si hay sesión válida consultando /auth/me
          // Try to get token from localStorage first
          const localToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

          const headers: Record<string,string> = {};
          if (localToken) {
            headers.Authorization = `Bearer ${localToken}`;
          }

          const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
            headers,
          });

          if (response.ok) {
            const data = await response.json();

            set({
                user: data.user,
                token: data.token || localToken || null,
                session: {
                  rol: data.user?.role
                    ? String(data.user.role).toUpperCase()
                    : undefined,
                  sucursalId: data.user?.sucursal || undefined,
                  usuarioId: data.user?.username || undefined,
                },
                isAuthenticated: true,
                isLoading: false,
                error: null,
              });
            // persist token to localStorage for fetch wrapper
            if (data.token && typeof window !== 'undefined') {
              localStorage.setItem('auth_token', data.token);
            }
          } else {
            set({
              user: null,
              session: null,
              isAuthenticated: false,
              isLoading: false,
              error: null,
            });
          }
        } catch (error) {
          set({
            user: null,
            session: null,
            isAuthenticated: false,
            error:
              error instanceof Error ? error.message : "Error loading session",
            isLoading: false,
          });
        }
      },

      clearSession: async () => {
        set({
          user: null,
          session: null,
          isAuthenticated: false,
          error: null,
        });
      },

      login: async (username: string, password: string) => {
        try {
          const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });

          if (!response.ok) {
            const data = await response.json();

            return {
              ok: false,
              error: data.error || "Error al iniciar sesión",
            };
          }

          const data = await response.json();

          set({
            user: data.user,
            token: data.token || null,
            session: {
              rol: data.user?.role
                ? String(data.user.role).toUpperCase()
                : undefined,
              sucursalId: data.user?.sucursal || undefined,
              usuarioId: data.user?.username || undefined,
            },
            isAuthenticated: true,
            error: null,
          });

          if (data.token && typeof window !== 'undefined') {
            localStorage.setItem('auth_token', data.token);
          }

          return { ok: true };
        } catch (error) {
          return { ok: false, error: "Error de conexión" };
        }
      },

      logout: async () => {
        try {
          // Call logout endpoint (will clear cookie if present) but client must drop token
          await fetch(`${getApiBaseUrl()}/auth/logout`, {
            method: "POST",
          }).catch(() => {
            // ignore
          });

          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
          }

          set({
            user: null,
            token: null,
            session: null,
            isAuthenticated: false,
            error: null,
          });

          return { ok: true };
        } catch (error) {
          return { ok: false, error: "Error de conexión" };
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        session: state.session,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
