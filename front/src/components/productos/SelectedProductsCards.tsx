import { Card, CardBody, Button, Input, Chip } from "@heroui/react";

import Icons from "@/components/icons/iconify";

export type ProductCardItem = {
  id: string | number;
  nombre: string;
  sku?: string;
  cantidad?: number;
  grupoNombre?: string;
  proveedorNombre?: string;
};

type Props = {
  items: ProductCardItem[];
  editable?: boolean;
  onChangeQuantity?: (id: string | number, cantidad: number) => void;
  onRemove?: (id: string | number) => void;
  className?: string;
};

export default function SelectedProductsCards({
  items,
  editable = true,
  onChangeQuantity,
  onRemove,
  className = "",
}: Props) {
  const handleQtyChange = (id: string | number, v: string) => {
    const n = Number(v);

    if (Number.isNaN(n)) return;
    onChangeQuantity && onChangeQuantity(id, n);
  };

  return (
    <div className={`grid grid-cols-1 gap-3 ${className}`}>
      {items.map((p) => (
        <Card key={p.id} className="w-full" isPressable={false}>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{p.nombre}</div>
                    {p.sku && (
                      <div className="text-sm text-default-500">
                        SKU: {p.sku}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      {p.grupoNombre && (
                        <Chip color="primary" size="sm" variant="flat">
                          {p.grupoNombre}
                        </Chip>
                      )}
                      {p.proveedorNombre && (
                        <Chip color="primary" size="sm" variant="flat">
                          {p.proveedorNombre}
                        </Chip>
                      )}
                    </div>
                    <div className="text-sm text-default-500">ID: {p.id}</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="w-28">
                    <Input
                      aria-label={`Cantidad ${p.nombre}`}
                      type="number"
                      value={String(p.cantidad ?? 1)}
                      onValueChange={(v) =>
                        editable && handleQtyChange(p.id, v)
                      }
                    />
                  </div>

                  {onRemove && (
                    <Button
                      color="danger"
                      size="sm"
                      variant="light"
                      onPress={() => onRemove(p.id)}
                    >
                      <Icons.trash className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
