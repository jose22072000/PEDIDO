import { Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Spinner } from "@heroui/react";

import PedidosPanelPage from "./pages/pedidos/panel-pedidos";
import NuevoPedidoPage from "./pages/pedidos/nuevo-pedido";
import PedidoProcesoPage from "./pages/pedidos/pedido-proceso";
import PedidoCompletadoPage from "./pages/pedidos/pedido-completados";
import PedidoExpiradosPage from "./pages/pedidos/pedido-expirados";
import UsuariosPanelPage from "./pages/usuarios/panel-usuarios";
import NuevoUsuarioPage from "./pages/usuarios/nuevo-usuario";
import ListaUsuariosPage from "./pages/usuarios/lista-usuarios";
import ConfiguracionPage from "./pages/configuracion/configuracion";

import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import SincronizacionPage from "@/pages/sincronizacion";
import PanelPageWrapper from "@/pages/panel-wrapper";
import LoginPage from "@/pages/login";
import UnauthorizedPage from "@/pages/unauthorized";
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
      <Route element={<UnauthorizedPage />} path="/unauthorized" />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<PanelPageWrapper />} path="/panel" />
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

      {/* Rutas protegidas solo para Administrador */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AdminRoute />}>
          {/* Usuarios */}
          <Route element={<UsuariosPanelPage />} path="/panel/panel-usuarios" />
          <Route
            element={<NuevoUsuarioPage />}
            path="/panel/panel-usuarios/nuevo"
          />
          <Route
            element={<ListaUsuariosPage />}
            path="/panel/panel-usuarios/lista"
          />

          {/* Configuración */}
          <Route element={<ConfiguracionPage />} path="/panel/configuracion" />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
