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
          {
            urlPattern: /\/api\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 hora
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
});
