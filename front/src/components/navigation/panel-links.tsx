import ActionCard from "../action-card";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";

// `soloGestion: true` = tarjeta de GESTIÓN (trabajadores, usuarios, sucursales, config):
// el rol Gestor NO la ve (solo ve lo suyo: pedidos, clientes, ventas, reportes).
// `soloSuperAdmin: true` = solo el Super Admin. Se usa para las pantallas cuyos
// endpoints ya responden 403 a los demás: enseñar el botón sería llevar a alguien a
// una pantalla vacía.
const CARDS: Array<{
  title: string;
  description: string;
  href: string;
  icon: string;
  soloGestion?: boolean;
  soloSuperAdmin?: boolean;
}> = [
  { title: "Productos", description: "Ver y gestionar catálogo", href: "/panel/panel-productos", icon: "product" },
  { title: "Pedidos", description: "Ver y gestionar pedidos", href: "/panel/panel-pedidos", icon: "pedido" },
  { title: "Visitas", description: "Ver y gestionar visitas", href: "/panel/visitas", icon: "visita" },
  { title: "Ventas", description: "Ver y gestionar ventas", href: "/panel/ventas", icon: "ventas" },
  { title: "Trabajadores", description: "Ver y gestionar trabajadores", href: "/panel/trabajadores", icon: "workers", soloGestion: true },
  { title: "Clientes", description: "Ver y gestionar clientes", href: "/panel/clientes", icon: "client" },
  { title: "Proveedores", description: "Ver y gestionar proveedores", href: "/panel/proveedores", icon: "partners", soloGestion: true },
  { title: "Negocios", description: "Ver y gestionar negocios", href: "/panel/negocios", icon: "store", soloGestion: true },
  { title: "Contactos", description: "Ver y gestionar contactos", href: "/panel/panel-contactos", icon: "contact", soloGestion: true },
  { title: "Sucursales", description: "Ver y gestionar sucursales", href: "/panel/config", icon: "locales", soloGestion: true },
  { title: "Usuarios", description: "Ver y gestionar usuarios", href: "/panel/usuarios", icon: "users", soloGestion: true },
  { title: "Reportes", description: "Ver y gestionar reportes", href: "/panel/reportes", icon: "reports" },
  // Las dos pantallas de COMPROBAR que algo corre solo. Son de gestión: quien sube
  // pedidos no tiene por qué mirar el estado de la facturación de la sucursal entera.
  { title: "Facturación", description: "Qué pedidos tienen factura y cuáles no", href: "/panel/sincronizacion/facturacion", icon: "reports", soloGestion: true },
  { title: "Clientes de Parranda", description: "Estado de la sincronización de clientes", href: "/panel/sincronizacion/clientes", icon: "client", soloSuperAdmin: true },
  { title: "Configuración", description: "Ajustes del sistema", href: "/panel/config", icon: "configuracion", soloGestion: true },
];

export const PanelLinks = () => {
  const { user } = useAuthStore();
  const rol = String(user?.role || "").toLowerCase();
  const isGestor = rol === "gestor";
  const isSuperAdmin = esRolGlobal(user?.role);
  const visibles = CARDS.filter(
    (c) => !(isGestor && c.soloGestion) && !(c.soloSuperAdmin && !isSuperAdmin),
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {visibles.map((c) => (
        <ActionCard
          key={c.title}
          color="primary"
          description={c.description}
          href={c.href}
          icon={c.icon}
          title={c.title}
        />
      ))}
    </div>
  );
};
