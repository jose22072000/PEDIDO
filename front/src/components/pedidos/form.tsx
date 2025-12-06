import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Textarea,

  Link,
} from "@heroui/react";
// import { Calendar } from "@heroui/react";
import { useState, useEffect } from "react";
// import {
//   today,
//   parseDate,
//   toCalendarDate,
//   getLocalTimeZone,
//   getDayOfWeek,
// } from "@internationalized/date";
import { useNavigate } from "react-router-dom";


import { cards } from "../primitives";

import { CatalogSelection, ProductSelectionQuantity } from "./product-list";
import { PedidoProductFilter } from "./product-filter";
import { PedidoProvider } from "./provider";

import { useAuthStore } from "@/stores/authStore";
import { useProductCatalogStore } from "@/stores/productCatalogStore";
import {
  useNegocioStore,
  usePedidoStore,
  useDetallePedidoStore,
} from "@/stores/entityStores";
// (Zod schemas for validation can be added here if/when integrating RHF)

export default function CrearPedidoForm() {
  const negocios = useNegocioStore((s) => s.items);
  const pedidoStore = usePedidoStore();
  const detalleStore = useDetallePedidoStore();
  const selected = useProductCatalogStore((s) => s.selected);
  const clearSelection = useProductCatalogStore((s) => s.clearSelection);
  const totalQuantity = useProductCatalogStore(
    (s) => s.getSelectedTotalQuantity,
  );
  const auth = useAuthStore((s) => s.session);

  const [negocioId, setNegocioId] = useState<string>(
    () => negocios?.[0]?.id ?? "",
  );
  // const [fechaPago, setFechaPago] = useState<string>(() => {
  //   try {
  //     const tz = getLocalTimeZone();

  //     return today(tz).add({ days: 1 }).toString().slice(0, 10);
  //   } catch (err) {
  //     return "";
  //   }
  // });
  const [observacion, setObservacion] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  // const _tz = getLocalTimeZone();
  // const minPaymentDate = useMemo(() => {
  //   return today(_tz).add({ days: 1 });
  // }, [_tz]);

  useEffect(() => {
    if ((!negocioId || negocioId === "") && negocios && negocios.length > 0) {
      setNegocioId(negocios[0].id);
    }
  }, [negocios, negocioId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || selected.length === 0) {
      alert("Seleccione al menos un producto");

      return;
    }

    setIsSubmitting(true);
    try {
      const pedidoId = `pedido_${Date.now()}`;

      await pedidoStore.create({
        id: pedidoId,
        trabajadorId: auth?.usuarioId ?? "unknown",
        sucursalId: auth?.sucursalId,
        negocioId: negocioId || undefined,
        estado: "PENDIENTE",
        observacion: observacion || undefined,
      } as any);

      // crear detalles
      for (const sItem of selected) {
        const detalleId = `detalle_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        await detalleStore.create({
          id: detalleId,
          pedidoId,
          productoId: String(sItem.id),
          cantidad: Number(sItem.cantidad) || 1,
        } as any);
      }

      clearSelection();
      navigate("/panel/pedidos");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error creando pedido", error);
      alert("Error al crear pedido");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PedidoProvider>
      <form
        className="flex flex-col gap-4 justify-between h-full"
        onSubmit={handleSubmit}
      >
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-6 items-start">
          <div className="w-full lg:col-span-4">
            <div className="space-y-6">
              <PedidoProductFilter />
              <CatalogSelection />
            </div>
          </div>
          <div className="flex-1 lg:col-span-2">
            <div className="space-y-4">
              <Card className={cards({ border: true })}>
                <CardBody className="space-y-3 p-0">                  
                  <div className="text-lg font-bold">
                    Productos seleccionados
                  </div>
                  <ProductSelectionQuantity />

                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-sm text-default-500">
                        Total items
                      </div>
                      <div className="font-semibold">{selected.length}</div>
                    </div>
                    <div>
                      <div className="text-sm text-default-500">
                        Cantidad total
                      </div>
                      <div className="font-semibold">{totalQuantity()}</div>
                    </div>
                  </div>                  
                  <Textarea
                    label="Observaciones"
                    value={observacion}
                    onChange={(e) => setObservacion(e.target.value)}
                  />
                </CardBody>
                <CardFooter className="pt-3 px-0 pb-0">
                  <div className="flex justify-between gap-2 w-full">
                    <Button
                      as={Link}
                      className="flex-1"
                      color="default"
                      href="/panel/panel-pedidos"
                      variant="flat"
                      onPress={() => {
                        clearSelection();
                        navigate("/panel");
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1"
                      color="warning"
                      isLoading={isSubmitting}
                      type="submit"
                    >
                      Crear Pedido
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </form>
    </PedidoProvider>
  );
}
