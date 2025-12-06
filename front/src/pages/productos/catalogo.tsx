import { NavigationHeading } from "@/components/navigation-heading";
import { PedidoProvider } from "@/components/pedidos/provider";
import { ProductFilter } from "@/components/productos/filter";
import { CatalogoList, useProductDetail } from "@/components/productos/views";

export default function CatalogoProductosPage() {
  const { modal, onPressAction } = useProductDetail();

  return (
    <section className="flex flex-col gap-4">
      <NavigationHeading
        cta={{
          href: "/panel/panel-productos",
          label: "Ir a Panel de Productos",
        }}
        icon="catalogo"
        paragraph="Visualiza, filtra y busca productos en el catálogo disponible."
        title="Catálogo de Productos"
      />
      <PedidoProvider>
        <div className="w-full space-y-6">
          <ProductFilter />
          <CatalogoList pressAction={onPressAction} />
        </div>
      </PedidoProvider>
      {modal}
    </section>
  );
}
