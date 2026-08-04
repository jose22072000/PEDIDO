import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Las librerías van en trozos APARTE del código de la aplicación. Cambian
        // muy de vez en cuando, así que el navegador se las queda cacheadas y un
        // despliegue nuevo solo obliga a bajar lo nuestro, no el megabyte de
        // HeroUI otra vez. En las sucursales, con enlaces lentos, eso es la
        // diferencia entre un despliegue que se nota y uno que no.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@heroui") || id.includes("@react-aria") || id.includes("@react-stately")) {
            return "ui";
          }
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) {
            return "animacion";
          }
          if (id.includes("@iconify")) return "iconos";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("victory-vendor")) {
            // Los gráficos solo salen en el panel y en mi perfil. Aparte, no los
            // baja quien entra a pedidos o a clientes.
            return "graficos";
          }
          if (id.includes("react-hook-form") || id.includes("/zod/") || id.includes("@hookform")) {
            return "formularios";
          }
          if (id.includes("react-router")) return "router";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("scheduler")) {
            return "react";
          }
          if (id.includes("xlsx") || id.includes("papaparse") || id.includes("jspdf")) {
            // Solo las usan el importador y la exportación de reportes: que no
            // las cargue quien únicamente entra a mirar el panel.
            return "ficheros";
          }

          return "vendor";
        },
      },
    },
    // Con los trozos ya separados, un aviso a 900 kB delata de verdad si algo
    // vuelve a engordar, en vez de saltar siempre como pasaba con el bundle único.
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    react(),
    tsconfigPaths(),
    tailwindcss(),
    VitePWA({
      // selfDestroying: el sw.js que se genera NO cachea nada — borra todas las
      // caches, se da de baja solo y recarga la pestania una vez.
      //
      // El 04/08/2026 el service worker dejo la aplicacion inutilizable: un bucle
      // de recarga hacia que se pidiera /sw.js y todos los ficheros cada segundo,
      // la pantalla quedaba en blanco y las peticiones de datos se amontonaban de
      // a cientos sin completarse. Y no se podia arreglar desde la aplicacion,
      // porque el propio service worker servia la version rota desde su cache: el
      // arreglo nuevo no llegaba a los navegadores.
      //
      // Esto es una herramienta de trabajo que se usa SIEMPRE con conexion —
      // ocho sucursales escribiendo a la vez—, asi que del service worker no
      // sacabamos nada: ni hacia falta trabajar sin red, ni conviene servir
      // pedidos guardados de hace rato. Lo que si daba era una forma de dejar a
      // todo el mundo tirado sin poder arreglarlo en caliente.
      //
      // Si algun dia se quiere PWA de verdad, se vuelve a activar CON un plan
      // para actualizar y para desinstalar, y probandolo con el service worker
      // puesto — que es como lo tiene la gente, y como no se probo esta vez.
      selfDestroying: true,
      registerType: "autoUpdate",
      includeAssets: ["*.png", "favicon.ico"],
      manifest: {
        name: "PROCOVAR",
        short_name: "PROCOVAR",
        description: "Sistema offline-first para gestión comercial",
        theme_color: "#054C74",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // El SW nuevo toma control de inmediato (sin esperar a cerrar todas las
        // pestañas) y borra cachés viejas: garantiza que un reload traiga los
        // últimos cambios en vez de quedar pegado a JS antiguo.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|svg|gif)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
              },
            },
          },
          // El service worker NO toca /api. Antes lo cacheaba con NetworkFirst y
          // un tope de 10 s, y eso trajo dos problemas:
          //
          // 1. Con el registro de red delante se vieron MIL SEISCIENTAS peticiones
          //    a /vendedores/gestores, todas "pendientes" y con 0 bytes, todas
          //    iniciadas por workbox. Al bloquear el service worker en una prueba
          //    con navegador de verdad, esa repeticion DESAPARECE: cada fichero se
          //    pide una vez. El bucle lo hacia el service worker, no la vista.
          //
          // 2. Aunque no se repitiera, cachear respuestas de la API significa
          //    servir pedidos, clientes o vendedores de hasta una hora antes sin
          //    que nada lo indique. En una aplicacion donde varias sucursales
          //    escriben a la vez, eso es enseniar datos que ya no son ciertos.
          //
          // Los datos ya no necesitan al service worker: viven en los stores (que
          // los conservan al navegar) y se actualizan por eventos en vivo.
          // Aqui se queda solo lo que de verdad no cambia: las imagenes.
        ],
      },
    }),
  ],
});
