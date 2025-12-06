import type { SesionLocal } from "@/domain";

import { create } from "zustand";

import { getById, put, del } from "@/lib/db";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3400/api";

interface AuthState {
  session: SesionLocal | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSession: () => Promise<void>;
  setSession: (session: SesionLocal) => Promise<void>;
  clearSession: () => Promise<void>;
  checkSession: () => boolean;
  login: (
    correo: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (
    email: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  resetPassword: (
    email: string,
    code: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  loadSession: async () => {
    try {
      set({ isLoading: true });
      const session = (await getById("sesion_local", "current_session")) as
        | SesionLocal
        | undefined;

      if (session) {
        const now = Date.now();
        const isValid = session.exp * 1000 > now;

        if (isValid) {
          set({ session, isAuthenticated: true, isLoading: false });
        } else {
          await get().clearSession();
        }
      } else {
        set({ session: null, isAuthenticated: false, isLoading: false });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error loading session",
        isLoading: false,
      });
    }
  },

  setSession: async (session: SesionLocal) => {
    try {
      await put("sesion_local", { ...session, id: "current_session" });
      set({ session, isAuthenticated: true, error: null });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Error saving session",
      });
    }
  },

  clearSession: async () => {
    try {
      await del("sesion_local", "current_session");
      set({ session: null, isAuthenticated: false, error: null });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Error clearing session",
      });
    }
  },

  checkSession: () => {
    const { session } = get();

    if (!session) return false;
    const now = Date.now();

    return session.exp * 1000 > now;
  },

  login: async (correo: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo, password }),
      });

      if (!response.ok) {
        const data = await response.json();

        return { ok: false, error: data.error || "Error al iniciar sesión" };
      }

      const data = await response.json();
      const session: SesionLocal = {
        id: "current_session",
        token: data.token,
        usuarioId: data.usuario.correo,
        trabajadorId: data.trabajador.email, // email es el PK del trabajador
        trabajadorEmail: data.trabajador.email,
        trabajadorNombre: data.trabajador.nombre,
        trabajadorDni: data.trabajador.dni,
        trabajadorTelefono: data.trabajador.telefono,
        rol: data.trabajador.rol,
        sucursalId: data.trabajador.sucursalId,
        iat: data.iat,
        exp: data.exp,
      };

      await get().setSession(session);

      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Error de conexión" };
    }
  },

  requestPasswordReset: async (email: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: email }),
      });

      if (!response.ok) {
        const data = await response.json();

        return { ok: false, error: data.error || "Error al enviar el código" };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Error de conexión" };
    }
  },

  resetPassword: async (email: string, code: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: email, code, newPassword: password }),
      });

      if (!response.ok) {
        const data = await response.json();

        return {
          ok: false,
          error: data.error || "Error al restablecer contraseña",
        };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Error de conexión" };
    }
  },
}));
