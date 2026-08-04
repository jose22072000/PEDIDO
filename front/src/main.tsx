import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";
import "@/styles/globals.css";
import "@/styles/components/typo.css";

// El Service Worker lo registra vite-plugin-pwa con `registerType: "autoUpdate"`
// (inyecta /registerSW.js). AQUI NO SE REGISTRA NADA, a proposito.
//
// Antes habia ademas un registro a mano con esto:
//
//     navigator.serviceWorker.addEventListener("controllerchange", () => {
//       if (recargado) return;
//       recargado = true;
//       window.location.reload();
//     });
//
// y eso era un BUCLE DE RECARGA infinito. El service worker se genera con
// `skipWaiting` + `clientsClaim`, asi que toma el control nada mas instalarse;
// al tomarlo salta `controllerchange` y la pagina se recargaba; en la pagina
// nueva la bandera `recargado` volvia a empezar en false —es una variable de
// modulo, muere con la pagina— asi que no frenaba nada, y vuelta a empezar.
//
// En el registro del servidor se veia el resultado: /sw.js y workbox-*.js
// pedidos cada pocos segundos desde moviles reales, y con cada re-instalacion
// TODOS los ficheros de la aplicacion otra vez. La pantalla quedaba en blanco
// porque se recargaba antes de terminar de pintar, y las peticiones de datos se
// amontonaban de a cientos sin llegar a completarse.
//
// Encima habia DOS registros compitiendo: este y el de registerSW.js. Y el
// `.catch` tapaba el sintoma con un mensaje en consola ("Cannot read properties
// of undefined (reading 'update')") en vez de dejar que se viera el problema.
//
// autoUpdate ya hace lo correcto solo: instala la version nueva y la activa en
// la siguiente navegacion, sin recargar por debajo de los pies del usuario.

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

// El service worker viejo dejo una cache de respuestas de /api en los navegadores
// que ya lo tenian instalado. Quitar la regla del build evita que se creen nuevas,
// pero NO borra la que ya esta: `cleanupOutdatedCaches` solo limpia los ficheros
// precargados, no las caches de ejecucion. Sin esto, quien ya tuviera la vieja
// seguiria viendo pedidos y vendedores de hasta una hora antes, y ademas era la
// que disparaba miles de peticiones repetidas.
//
// Se borra una sola vez al arrancar y no molesta a nadie: si no existe, no hace
// nada.
if (typeof caches !== "undefined") {
  caches.delete("api-cache").catch(() => {
    // Sin permisos o navegador sin Cache API: no es critico, se sigue.
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
