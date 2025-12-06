import { Route, Routes } from "react-router-dom";

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

import ProtectedRoute from "@/components/ProtectedRoute";
import ProductosPanelPage from "@/pages/productos/panel-productos";
import SincronizacionPage from "@/pages/sincronizacion";
import PanelPage from "@/pages/panel";
import ResetPasswordPage from "@/pages/reset-password";
import ForgotPasswordPage from "@/pages/forgot-password";
import LoginPage from "@/pages/login";

function App() {
  return (
    <Routes>
      {/* Rutas públicas (autenticación) */}
      <Route element={<LoginPage />} path="/" />
      <Route element={<ForgotPasswordPage />} path="/forgot-password" />
      <Route element={<ResetPasswordPage />} path="/reset-password" />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<PanelPage />} path="/panel" />
        <Route element={<SincronizacionPage />} path="/panel/sincronizacion" />

        {/* Productos */}
        <Route element={<ProductosPanelPage />} path="/panel/panel-productos" />
        <Route
          element={<CatalogoProductosPage />}
          path="/panel/panel-productos/catalogo"
        />
        <Route
          element={<GruposProductosPage />}
          path="/panel/panel-productos/gestion-grupos"
        />
        <Route
          element={<ProveedoresProductosPage />}
          path="/panel/panel-productos/gestion-proveedores"
        />

        {/* Pedidos */}
        <Route element={<PedidosPanelPage />} path="/panel/panel-pedidos" />
        <Route
          element={<NuevoPedidoPage />}
          path="/panel/panel-pedidos/nuevo"
        />

        {/* Negocios */}
        <Route element={<NegociosPanelPage />} path="/panel/panel-negocio" />
        <Route
          element={<NegociosAsignadosPage />}
          path="/panel/panel-negocio/asignados"
        />
        <Route
          element={<NuevoNegocioPage />}
          path="/panel/panel-negocio/nuevo"
        />

        {/* Sucursales */}
        <Route element={<SucursalesPanelPage />} path="/panel/panel-sucursal" />
        <Route
          element={<NuevaSucursalPage />}
          path="/panel/panel-sucursal/nuevo"
        />
        <Route
          element={<VisualizarSucursalPage />}
          path="/panel/panel-sucursal/visualizar"
        />
        <Route
          element={<ReportesSucursalPage />}
          path="/panel/panel-sucursal/reportes"
        />

        {/* Contactos */}
        <Route element={<ContactosPanelPage />} path="/panel/panel-contactos" />
      </Route>
    </Routes>
  );
}

export default App;
