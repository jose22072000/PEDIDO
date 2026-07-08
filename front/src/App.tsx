import { Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Spinner } from "@heroui/react";

import PedidosPanelPage from "./pages/pedidos/panel-pedidos";
import NuevoPedidoPage from "./pages/pedidos/nuevo-pedido";
import UsuariosPanelPage from "./pages/usuarios/panel-usuarios";
import NuevoUsuarioPage from "./pages/usuarios/nuevo-usuario";
import ListaUsuariosPage from "./pages/usuarios/lista-usuarios";
import VendedoresPage from "./pages/vendedores/vendedores";
import ClientesPage from "./pages/clientes/clientes";
import ConfiguracionPage from "./pages/configuracion/configuracion";
import ReportesPage from "./pages/reportes/reportes";
import ReportePedidosFechaPage from "./pages/reportes/pedidos-fecha";
import ReportePedidosVendedorPage from "./pages/reportes/pedidos-vendedor";
import ReportePedidosEstadoPage from "./pages/reportes/pedidos-estado";
import ReporteProductosVendedorPage from "./pages/reportes/productos-vendedor";

import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
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

        {/* Pedidos */}
        <Route element={<PedidosPanelPage />} path="/panel/panel-pedidos" />

        {/* Vendedores */}
        <Route element={<VendedoresPage />} path="/panel/trabajadores" />

        {/* Clientes */}
        <Route element={<ClientesPage />} path="/panel/clientes" />

        {/* Reportes */}
        <Route element={<ReportesPage />} path="/panel/reportes" />
        <Route
          element={<ReportePedidosFechaPage />}
          path="/panel/reportes/pedidos-fecha"
        />
        <Route
          element={<ReportePedidosVendedorPage />}
          path="/panel/reportes/pedidos-vendedor"
        />
        <Route
          element={<ReportePedidosEstadoPage />}
          path="/panel/reportes/pedidos-estado"
        />
        <Route
          element={<ReporteProductosVendedorPage />}
          path="/panel/reportes/productos-vendedor"
        />
      </Route>

      {/* Rutas protegidas para Administrador y Supervisor */}
      <Route element={<ProtectedRoute />}>
        <Route
          element={
            <AdminRoute
              allowedRoles={["Super Admin", "Administrador", "Supervisor"]}
            />
          }
        >
          {/* Nuevo Pedido */}
          <Route
            element={<NuevoPedidoPage />}
            path="/panel/panel-pedidos/nuevo"
          />
        </Route>
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
