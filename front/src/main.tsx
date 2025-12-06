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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
