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
  // updateViaCache "none": el navegador SIEMPRE re-descarga sw.js (no lo cachea), así
  // no se queda pegado en una versión vieja de la app durante días.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update(); // busca versión nueva al abrir
        // y revisa cada hora por si la pestaña queda abierta mucho tiempo
        setInterval(() => reg.update(), 60 * 60 * 1000);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Service Worker registration failed:", error);
      });
  });

  // Cuando un SW nuevo toma el control (autoUpdate), recargar UNA vez para servir ya la
  // versión nueva sin que el usuario tenga que limpiar caché a mano.
  let recargado = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargado) return;
    recargado = true;
    window.location.reload();
  });
}

// Global fetch wrapper: attach Authorization Bearer header from localStorage if present
// This keeps existing fetch calls working without modifying every file.
import { senalConTope } from "@/lib/senal-con-tope";

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

  // Timeout de seguridad para TODA petición: en enlaces flaky (Starlink) un fetch
  // puede quedar colgado sin respuesta (el TCP no muere en minutos) y fetch NO trae
  // timeout propio → spinner infinito en carga y al guardar. Abortamos a los 25s.
  // Solo se exceptúan streams SSE e imports/subidas, largos por diseño.
  //
  // OJO con las peticiones que YA traen `signal`: antes se les dejaba pasar SIN
  // timeout, y como los stores de datos siempre pasan uno (para poder cancelar al
  // cambiar de filtro), TODAS las vistas migradas se quedaron sin la red de
  // seguridad. Resultado: con la red mala, el spinner no terminaba nunca. Ahora la
  // señal de fuera y la del reloj se COMBINAN: cancelar sigue funcionando igual, y
  // además hay un tope de tiempo.
  const reqUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request)?.url || "";
  // NADA es ilimitado salvo los streams. Antes las subidas e importaciones se
  // dejaban pasar SIN tope ninguno "porque son largas": largo no es infinito, y
  // una subida colgada dejaba el boton girando para siempre sin decir nada.
  // Ahora hay dos niveles.
  //
  //  - Streams (SSE): sin tope de verdad. Estan abiertos a proposito mientras
  //    dure la sesion; cortarlos seria romperlos.
  //  - Subidas e importaciones: tope LARGO. Un CSV grande por un enlace lento
  //    tarda minutos, y cortarlo a los 25 s seria imposible trabajar. Pero a los
  //    10 minutos ya no esta tardando: esta colgado.
  //  - Todo lo demas: 25 s.
  const esStream = /\/events\/stream|\/import-stream/.test(reqUrl);

  if (esStream) {
    return _origFetch(input, init);
  }

  const esSubida = /\/orders\/bulk|\/import|\/upload/.test(reqUrl);

  init = init || {};
  const { signal, limpiar } = senalConTope(init.signal, esSubida ? 10 * 60_000 : 25_000);

  init.signal = signal;

  return _origFetch(input, init).finally(limpiar);
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
