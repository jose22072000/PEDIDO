import { Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Spinner } from "@heroui/react";

import CatalogoProductosPage from "./pages/productos/catalogo";
import GruposProductosPage from "./pages/productos/gestion-grupos";
import ProveedoresProductosPage from "./pages/productos/gestion-proveedor";
import PedidosPanelPage from "./pages/pedidos/panel-pedidos";
import NuevoPedidoPage from "./pages/pedidos/nuevo-pedido";
import ContactosPanelPage from "./pages/contactos/panel-contactos";
import NegociosPanelPage from "./pages/negocios/panel";
import NegociosAsignadosPage from "./pages/negocios/asignados";
import NuevoNegocioPage from "./pages/negocios/nuevo";
import SucursalesPanelPage from "./pages/sucursales/panel";
import NuevaSucursalPage from "./pages/sucursales/nuevo";
import VisualizarSucursalPage from "./pages/sucursales/visualizar";
import ReportesSucursalPage from "./pages/sucursales/reportes";
import PedidoProcesoPage from "./pages/pedidos/pedido-proceso";
import PedidoCompletadoPage from "./pages/pedidos/pedido-completados";
import PedidoExpiradosPage from "./pages/pedidos/pedido-expirados";

import ProtectedRoute from "@/components/ProtectedRoute";
import ProductosPanelPage from "@/pages/productos/panel-productos";
import SincronizacionPage from "@/pages/sincronizacion";
import PanelPage from "@/pages/panel";
import ResetPasswordPage from "@/pages/reset-password";
import ForgotPasswordPage from "@/pages/forgot-password";
import LoginPage from "@/pages/login";
import { useAuthStore } from "@/stores/authStore";

function App() {
  const { loadSession, isLoading } = useAuthStore();

  useEffect(() => {
    loadSession();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner color="primary" size="lg" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Rutas públicas (autenticación) */}
      <Route element={<LoginPage />} path="/" />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<PanelPage />} path="/panel" />
        <Route element={<SincronizacionPage />} path="/panel/sincronizacion" />

        {/* Pedidos */}
        <Route element={<PedidosPanelPage />} path="/panel/panel-pedidos" />
        <Route
          element={<NuevoPedidoPage />}
          path="/panel/panel-pedidos/nuevo"
        />
        <Route
          element={<PedidoProcesoPage />}
          path="/panel/panel-pedidos/pedido-proceso"
        />
        <Route
          element={<PedidoCompletadoPage />}
          path="/panel/panel-pedidos/pedido-completados"
        />
        <Route
          element={<PedidoExpiradosPage />}
          path="/panel/panel-pedidos/pedido-expirados"
        />
      </Route>
    </Routes>
  );
}

export default App;
