import ActionCard from "../action-card";

export const PanelLinks = () => {
  return (
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
      <ActionCard
        color="warning"
        description="Ver y gestionar negocios"
        href="/panel/negocios"
        icon="store"
        title="Negocios"
      />
      <ActionCard
        color="warning"
        description="Ver y gestionar contactos"
        href="/panel/panel-contactos"
        icon="contact"
        title="Contactos"
      />
      <ActionCard
        color="warning"
        description="Ver y gestionar sucursales"
        href="/panel/config"
        icon="locales"
        title="Sucursales"
      />
      <ActionCard
        color="warning"
        description="Ver y gestionar usuarios"
        href="/panel/usuarios"
        icon="users"
        title="Usuarios"
      />
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
  );
};
