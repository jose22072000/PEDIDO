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

// Un trozo de la aplicacion que no se pudo bajar, cazado ANTES de que llegue a la
// consola como error suelto.
//
// Vite avisa con `vite:preloadError` cuando un import diferido falla. Pasa despues de
// cada despliegue: la pestania abierta sigue con el index.html viejo y pide ficheros
// con nombres que ya no existen.
//
// AQUI NO SE RECARGA NADA. Se deja que el fallo llegue al aviso de pantalla, que tiene
// su boton. Recargar solo se probo dos veces —04/08/2026 y 08/08/2026— y las dos
// acabaron en bucle de recargas con la aplicacion inutilizable; un boton que hay que
// pulsar es peor experiencia y mejor idea.
window.addEventListener("vite:preloadError", () => {
  // eslint-disable-next-line no-console
  console.warn(
    "[despliegue] falta un trozo de la aplicacion (version vieja en esta pestania). " +
      "Hay que recargar con el boton del aviso, que ademas limpia las cachés.",
  );
});

// Global fetch wrapper: attach Authorization Bearer header from localStorage if present
// This keeps existing fetch calls working without modifying every file.
import { senalConTope } from "@/lib/senal-con-tope";
import { getSucursalActiva } from "@/lib/sucursal-activa";

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
    let esGlobal = false;
    let sessionSucursalId: string | undefined;

    if (authStorageRaw) {
      try {
        const parsed = JSON.parse(authStorageRaw) as {
          state?: { session?: { sucursalId?: string; isGlobalAdmin?: boolean } };
        };

        sessionSucursalId = parsed?.state?.session?.sucursalId;
        esGlobal = Boolean(parsed?.state?.session?.isGlobalAdmin);
      } catch {
        // ignore invalid persisted payload
      }
    }

    // La sucursal ENFOCADA es cosa del Super Admin: es el unico que no tiene
    // sucursal propia y puede elegir en cual concentrarse. Los demas van SIEMPRE
    // a la suya, la que dice su sesion.
    //
    // Antes se usaba la guardada para todo el mundo, y ahi estuvo el fallo:
    // tras entrar como admin enfocado en una sucursal y luego con otra cuenta,
    // esa eleccion seguia guardada y el navegador mandaba la sucursal de OTRO.
    // El servidor lo rechazaba con razon -> 400 en pedidos, vendedores, clientes
    // y en el canal de eventos, todo a la vez. Ahora el valor guardado ni se
    // mira si el que pide no es global: no hay forma de que vuelva a pasar.
    const sucursalId = esGlobal ? getSucursalActiva() : sessionSucursalId;

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

  return _origFetch(input, init)
    .then((r) => {
      avisarSiCaducoLaSesion(r, reqUrl);

      return r;
    })
    .finally(limpiar);
}) as typeof window.fetch;

/**
 * Si el servidor contesta 401, la sesion ya no vale: se avisa UNA vez y desde
 * un solo sitio.
 *
 * El token dura 7 dias y las operadoras dejan la pestaña abierta toda la
 * semana. Cuando caduca, la siguiente accion falla — y cada pantalla enseñaba
 * su propio texto generico ("Error al completar el pedido"), asi que parecia
 * que el sistema estaba roto en vez de que habia que volver a entrar. El
 * 07/08/2026 dos operadoras estuvieron asi sin que nadie supiera por que.
 *
 * Va en el envoltorio de `fetch` a proposito: cubre TODAS las pantallas, las de
 * hoy y las que se hagan mañana, sin que nadie tenga que acordarse.
 */
function avisarSiCaducoLaSesion(r: Response, url: string) {
  // El login contesta 401 cuando la contraseña esta mal: eso NO es una sesion
  // caducada, y echar a alguien de una pantalla donde todavia no ha entrado no
  // tendria sentido.
  if (r.status !== 401 || /\/auth\/(login|me)/.test(url)) return;

  window.dispatchEvent(new CustomEvent("sesion-caducada"));
}

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
