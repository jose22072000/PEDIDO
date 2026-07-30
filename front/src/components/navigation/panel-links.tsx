import ActionCard from "../action-card";
import { useAuthStore } from "@/stores/authStore";

// `soloGestion: true` = tarjeta de GESTIÓN (trabajadores, usuarios, sucursales, config):
// el rol Gestor NO la ve (solo ve lo suyo: pedidos, clientes, ventas, reportes).
const CARDS: Array<{
  title: string;
  description: string;
  href: string;
  icon: string;
  soloGestion?: boolean;
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
  { title: "Configuración", description: "Ajustes del sistema", href: "/panel/config", icon: "configuracion", soloGestion: true },
];

export const PanelLinks = () => {
  const { user } = useAuthStore();
  const isGestor = String(user?.role || "").toLowerCase() === "gestor";
  const visibles = CARDS.filter((c) => !(isGestor && c.soloGestion));

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
