import { Route, Routes } from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { Spinner } from "@heroui/react";

import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import LoginPage from "@/pages/login";
import UnauthorizedPage from "@/pages/unauthorized";
import { useAuthStore } from "@/stores/authStore";
import { LimiteError } from "@/components/limite-error";

// ─────────────────────────────────────────────────────────────────────────────
// CARGA PEREZOSA por ruta.
//
// Antes todo iba en un único JS de ~1,95 MB: al entrar, el navegador tenía que
// bajar y ejecutar la app ENTERA —reportes, configuración, importador de CSV—
// antes de pintar el login. En las sucursales, con enlaces lentos y de mucha
// latencia, eso es la diferencia entre entrar en segundos o en minutos.
//
// Ahora cada ruta es su propio trozo y se baja solo cuando se visita. Login y
// panel entran directos; el resto llega cuando hace falta.
//
// Login, ProtectedRoute y AdminRoute NO son perezosos a propósito: son lo primero
// que se pinta y meterlos en un trozo aparte añadiría una ida y vuelta más justo
// en el arranque, que es exactamente lo que se quiere evitar.
// ─────────────────────────────────────────────────────────────────────────────
const PanelPageWrapper = lazy(() => import("@/pages/panel-wrapper"));
const PedidosPanelPage = lazy(() => import("./pages/pedidos/panel-pedidos"));
const NuevoPedidoPage = lazy(() => import("./pages/pedidos/nuevo-pedido"));
const UsuariosPanelPage = lazy(() => import("./pages/usuarios/panel-usuarios"));
const NuevoUsuarioPage = lazy(() => import("./pages/usuarios/nuevo-usuario"));
const ListaUsuariosPage = lazy(() => import("./pages/usuarios/lista-usuarios"));
const VendedoresPage = lazy(() => import("./pages/vendedores/vendedores"));
const ClientesPage = lazy(() => import("./pages/clientes/clientes"));
const MiPerfilPage = lazy(() => import("./pages/perfil/mi-perfil"));
const ConfiguracionPage = lazy(
  () => import("./pages/configuracion/configuracion"),
);
const ReportesPage = lazy(() => import("./pages/reportes/reportes"));
const ReportePedidosFechaPage = lazy(
  () => import("./pages/reportes/pedidos-fecha"),
);
const ReportePedidosVendedorPage = lazy(
  () => import("./pages/reportes/pedidos-vendedor"),
);
const ReportePedidosEstadoPage = lazy(
  () => import("./pages/reportes/pedidos-estado"),
);
const ReporteCopiasPage = lazy(
  () => import("./pages/reportes/copias-portapapeles"),
);
const ReporteProductosVendedorPage = lazy(
  () => import("./pages/reportes/productos-vendedor"),
);

const Cargando = () => (
  <div className="flex h-[60vh] w-full items-center justify-center">
    <Spinner color="primary" size="lg" />
  </div>
);

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
    // LimiteError envuelve TODAS las rutas: si una vista falla —o si el
    // navegador no puede bajar su trozo de codigo, que es lo que pasa con una
    // pestaña abierta desde antes del ultimo despliegue— se ve un aviso con
    // "reintentar" y "volver atras" en vez de una pantalla en blanco de la que
    // no se puede salir.
    <LimiteError nombre="esta pantalla">
      <Suspense fallback={<Cargando />}>
        <Routes>
          {/* Rutas públicas (autenticación) */}
          <Route element={<LoginPage />} path="/" />
          <Route element={<UnauthorizedPage />} path="/unauthorized" />

          {/* Rutas protegidas */}
          <Route element={<ProtectedRoute />}>
            <Route element={<PanelPageWrapper />} path="/panel" />

            {/* Pedidos */}
            <Route element={<PedidosPanelPage />} path="/panel/panel-pedidos" />

            {/* Vendedores. El OPERADOR tambien entra: es quien factura, y necesita
              ver los vendedores de SU sucursal para copiar el codigo al
              portapapeles y pegarlo en el sistema contable. Solo eso — no puede
              dar de alta/baja ni reasignar gestor (se le ocultan los botones, y
              el servidor lo rechaza igual). El Gestor sigue sin entrar. */}
            <Route
              element={
                <AdminRoute
                  allowedRoles={[
                    "Super Admin",
                    "Administrador",
                    "Supervisor",
                    "Operador",
                  ]}
                />
              }
            >
              <Route element={<VendedoresPage />} path="/panel/trabajadores" />
            </Route>

            {/* Clientes */}
            <Route element={<ClientesPage />} path="/panel/clientes" />

            {/* Mi perfil: cualquier usuario autenticado ve SUS datos y SUS métricas. */}
            <Route element={<MiPerfilPage />} path="/panel/mi-perfil" />

            {/* Reportes: NO son para el Operador. Factura con los pedidos que ya
              están; sacar informes de la sucursal no es cosa suya. El servidor
              los rechaza igual para su rol. */}
            <Route
              element={
                <AdminRoute
                  allowedRoles={[
                    "Super Admin",
                    "Administrador",
                    "Supervisor",
                    "Gestor",
                  ]}
                />
              }
            >
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
              <Route
                element={<ReporteCopiasPage />}
                path="/panel/reportes/copias"
              />
            </Route>
          </Route>

          {/* Nuevo Pedido / Importar: roles operativos suben SUS pedidos. El backend scopea
            por sucursal y, para el gestor, restringe a SUS vendedores. Allowlist EXPLÍCITA
            (no "cualquier autenticado") para que un rol futuro de solo-lectura no importe.
            El OPERADOR no entra: factura con lo que ya está subido, no mete datos. */}
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <AdminRoute
                  allowedRoles={[
                    "Super Admin",
                    "Administrador",
                    "Supervisor",
                    "Gestor",
                  ]}
                />
              }
            >
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
              <Route
                element={<UsuariosPanelPage />}
                path="/panel/panel-usuarios"
              />
              <Route
                element={<NuevoUsuarioPage />}
                path="/panel/panel-usuarios/nuevo"
              />
              <Route
                element={<ListaUsuariosPage />}
                path="/panel/panel-usuarios/lista"
              />
            </Route>
          </Route>

          {/* Configuración (sucursales, parámetros, borrar base): SOLO Super Admin.
            Un Administrador es de una única sucursal y no debe entrar aquí. */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AdminRoute allowedRoles={["Super Admin"]} />}>
              <Route
                element={<ConfiguracionPage />}
                path="/panel/configuracion"
              />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </LimiteError>
  );
}

export default App;
