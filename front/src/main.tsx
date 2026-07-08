import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";
import "@/styles/globals.css";
import "@/styles/components/typo.css";

// Registrar Service Worker para PWA (solo en producción / sobre https)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // En dev Vite puede devolver index.html con tipo text/html para rutas desconocidas
  // por eso registramos sólo en producción para evitar el error MIME.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Service Worker registration failed:", error);
    });
  });
}

// Global fetch wrapper: attach Authorization Bearer header from localStorage if present
// This keeps existing fetch calls working without modifying every file.
const _origFetch = window.fetch.bind(window) as (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    const authStorageRaw =
      typeof window !== "undefined" ? localStorage.getItem("auth-storage") : null;
    let sessionSucursalId: string | undefined;

    if (authStorageRaw) {
      try {
        const parsed = JSON.parse(authStorageRaw) as {
          state?: { session?: { sucursalId?: string } };
        };
        sessionSucursalId = parsed?.state?.session?.sucursalId;
      } catch {
        // ignore invalid persisted payload
      }
    }

    // El Super Admin no tiene sucursal propia: puede elegir una para enfocarse
    // ("sucursal_activa"). Si no elige ninguna, no se manda header y ve TODAS.
    const sucursalActiva =
      typeof window !== "undefined"
        ? localStorage.getItem("sucursal_activa")
        : null;
    const sucursalId = sucursalActiva || sessionSucursalId;

    init = init || {};
    init.headers = Object.assign(
      {},
      (init.headers as Record<string, string>) || {},
      sucursalId ? { "x-sucursal-id": sucursalId } : {},
      token ? { Authorization: `Bearer ${token}` } : {},
    );
  } catch (e) {
    // ignore
  }

  return _origFetch(input, init);
}) as typeof window.fetch;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
