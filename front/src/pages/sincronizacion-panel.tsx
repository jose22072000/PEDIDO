import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";

import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useSyncStore } from "@/stores/syncStore";
import { useAuthStore } from "@/stores/authStore";
import PanelLayout from "@/layouts/panel";

export default function PanelPage() {
  const navigate = useNavigate();
  const { isLoading } = useAuthGuard();
  const { isOnline, isSyncing, pendingCount, failedCount, updateStats } =
    useSyncStore();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    updateStats();
  }, [updateStats]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  if (isLoading) {
    return (
      <PanelLayout>
        <div className="flex items-center justify-center min-h-screen" />
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <section className="flex flex-col gap-4 py-8 md:py-10">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Panel de Control</h1>
            <p className="text-default-500">Bienvenido al sistema PROCOVAR</p>
          </div>
          <Button color="danger" variant="light" onPress={handleLogout}>
            Cerrar sesión
          </Button>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-bold">Estado del Sistema</h2>
          </CardHeader>
          <CardBody className="gap-4">
            <div className="flex gap-2 items-center">
              <span>Conexión:</span>
              <Chip color={isOnline ? "success" : "danger"} variant="flat">
                {isOnline ? "En línea" : "Sin conexión"}
              </Chip>
            </div>
            <div className="flex gap-2 items-center">
              <span>Sincronización:</span>
              <Chip color={isSyncing ? "primary" : "default"} variant="flat">
                {isSyncing ? "Sincronizando..." : "Inactivo"}
              </Chip>
            </div>
            <div className="flex gap-2 items-center">
              <span>Pendientes por sincronizar:</span>
              <Chip
                color={pendingCount > 0 ? "primary" : "success"}
                variant="flat"
              >
                {pendingCount}
              </Chip>
            </div>
            <div className="flex gap-2 items-center">
              <span>Errores de sincronización:</span>
              <Chip
                color={failedCount > 0 ? "danger" : "success"}
                variant="flat"
              >
                {failedCount}
              </Chip>
            </div>
            {user && (
              <>
                <div className="flex gap-2 items-center">
                  <span>Usuario:</span>
                  <span className="text-default-500">{user.username}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <span>Rol:</span>
                  <Chip color="primary" variant="flat">
                    {user.role || "Usuario"}
                  </Chip>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card isPressable onPress={() => navigate("/sincronizacion")}>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Sincronización</h3>
              <p className="text-sm text-default-500">
                Ver y gestionar la cola de sincronización
              </p>
            </CardBody>
          </Card>

          <Card isPressable>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Productos</h3>
              <p className="text-sm text-default-500">
                Gestionar catálogo de productos
              </p>
            </CardBody>
          </Card>

          <Card isPressable>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Ventas</h3>
              <p className="text-sm text-default-500">
                Registrar nuevas ventas
              </p>
            </CardBody>
          </Card>

          <Card isPressable>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Pedidos</h3>
              <p className="text-sm text-default-500">Gestionar pedidos</p>
            </CardBody>
          </Card>

          <Card isPressable>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Visitas</h3>
              <p className="text-sm text-default-500">
                Registrar visitas a clientes
              </p>
            </CardBody>
          </Card>

          <Card isPressable>
            <CardBody className="text-center">
              <h3 className="text-lg font-bold">Negocios</h3>
              <p className="text-sm text-default-500">
                Gestionar negocios y contactos
              </p>
            </CardBody>
          </Card>
        </div>
      </section>
    </PanelLayout>
  );
}
