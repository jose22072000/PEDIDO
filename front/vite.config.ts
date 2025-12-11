import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
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
        theme_color: "#f59e0b",
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
  server: {
    host: '0.0.0.0', // Allow access from network
    port: 5173,
    // Proxy API requests to backend to keep cookies same-origin during dev
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:8400",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
