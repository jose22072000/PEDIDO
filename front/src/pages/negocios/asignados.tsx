import { useEffect } from "react";

import { NavigationHeading } from "@/components/navigation-heading";
import { NegociosLoader } from "@/components/negocios/provider";
import { NegocioFilter } from "@/components/negocios/filter";
import { NegocioList } from "@/components/negocios/list";
import { useNegocioDetail } from "@/components/negocios/detail-drawer";
import { useAuthStore } from "@/stores/authStore";
import useNegocioCatalogStore from "@/stores/negocioCatalogStore";

export default function NegociosAsignadosPage() {
  const session = useAuthStore((s) => s.session);
  const setFilterTrabajador = useNegocioCatalogStore(
    (s) => s.setFilterTrabajador,
  );
  const { modal, onPressAction } = useNegocioDetail();

  useEffect(() => {
    // Solo auto-filtrar para VENDEDORES
    // ADMIN/DIRECTIVO/GERENTE/etc pueden ver todos y filtrar manualmente
    const isVendedor = session?.rol === "VENDEDOR";

    if (isVendedor && session?.usuarioId) {
      setFilterTrabajador(session.usuarioId);
    }

    // Clean up filter on unmount
    return () => {
      setFilterTrabajador(undefined);
    };
  }, [session?.usuarioId, session?.rol, setFilterTrabajador]);

  return (
    <NegociosLoader>
      <section className="flex flex-col gap-6">
        <NavigationHeading
          cta={{
            href: "/panel/panel-negocio",
            label: "Ir a Panel de Negocios",
          }}
          icon="store"
          paragraph="Negocios asignados a ti como vendedor"
          title="Negocios Asignados"
        />

        <NegocioFilter type="asignados" />

        <NegocioList pressAction={onPressAction} />

        {modal}
      </section>
    </NegociosLoader>
  );
}
