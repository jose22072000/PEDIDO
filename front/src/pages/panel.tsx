import { useEffect } from "react";

import { useSyncStore } from "@/stores/syncStore";
import { NavigationHeading } from "@/components/navigation-heading";
import ActionCard from "@/components/action-card";

export default function PanelPage() {
  const { updateStats } = useSyncStore();

  useEffect(() => {
    updateStats();
  }, [updateStats]);

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{ href: "/", label: "Ir al Inicio" }}
        paragraph="Visualiza todas las acciones a realizar en el sistema."
        title="Panel de Control"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <ActionCard
          color="warning"
          description="Ver y gestionar catálogo"
          href="/panel/panel-productos"
          icon="product"
          title="Productos"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar pedidos"
          href="/panel/panel-pedidos"
          icon="pedido"
          title="Pedidos"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar visitas"
          href="/panel/visitas"
          icon="visita"
          title="Visitas"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar ventas"
          href="/panel/ventas"
          icon="ventas"
          title="Ventas"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar trabajadores"
          href="/panel/trabajadores"
          icon="workers"
          title="Trabajadores"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar proveedores"
          href="/panel/proveedores"
          icon="partners"
          title="Proveedores"
        />
        {/* <ActionCard
          color="warning"
          description="Ver y gestionar negocios"
          href="/panel/panel-negocio"
          icon="store"
          title="Negocios"
        />
        <ActionCard
          color="warning"
          description="Ver y gestionar contactos"
          href="/panel/panel-contactos"
          icon="contact"
          title="Contactos"
        /> */}
        <ActionCard
          color="warning"
          description="Ver y gestionar sucursales"
          href="/panel/panel-sucursal"
          icon="locales"
          title="Sucursales"
        />
        {/* <ActionCard
          color="warning"
          description="Ver y gestionar usuarios"
          href="/panel/usuarios"
          icon="users"
          title="Usuarios"
        /> */}
        <ActionCard
          color="warning"
          description="Ver y gestionar reportes"
          href="/panel/reportes"
          icon="reports"
          title="Reportes"
        />
        <ActionCard
          color="warning"
          description="Ajustes del sistema"
          href="/panel/config"
          icon="configuracion"
          title="Configuración"
        />
      </div>

      {/* <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Estado de Sincronización</h3>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span>Conexión:</span>
                <Chip color={isOnline ? 'success' : 'danger'} size="sm">
                  {isOnline ? 'En línea' : 'Sin conexión'}
                </Chip>
              </div>
              <div className="flex justify-between">
                <span>Pendientes:</span>
                <Chip color="warning" size="sm">{pendingCount}</Chip>
              </div>
              <div className="flex justify-between">
                <span>Fallidos:</span>
                <Chip color="danger" size="sm">{failedCount}</Chip>
              </div>
              <div className="flex justify-between">
                <span>Estado:</span>
                <Chip color={isSyncing ? 'primary' : 'default'} size="sm">
                  {isSyncing ? 'Sincronizando...' : 'Inactivo'}
                </Chip>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Usuario</h3>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col">
                <span className="text-sm text-default-500">Nombre:</span>
                <span className="font-medium">{session?.nombre || 'N/A'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-default-500">Correo:</span>
                <span className="font-medium">{session?.correo || 'N/A'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-default-500">Rol:</span>
                <Chip color="warning" size="sm">{session?.rol || 'N/A'}</Chip>
              </div>
              <Button color="danger" size="sm" onClick={handleLogout}>
                Cerrar Sesión
              </Button>
            </div>
          </CardBody>
        </Card>
      </div> */}
    </section>
  );
}
