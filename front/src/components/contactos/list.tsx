import { Card, CardBody, Chip, Pagination, Tooltip } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import Icons from "../icons/iconify";
import { cards } from "../primitives";

import { useNegocioStore } from "@/stores/entityStores";
import { useContactCatalogStore } from "@/stores/contactCatalogStore";

type Mode = "empresa" | "mios" | "sucursal";

export const ContactosList = ({
  pressAction,
  mode = "empresa",
  cardIcon = "contact",
}: {
  pressAction?: (id?: string | number) => void;
  mode?: Mode;
  cardIcon?: keyof typeof Icons | string;
}) => {
  const CardIconComp: React.ComponentType<any> =
    (Icons as any)[cardIcon] ?? (Icons as any)["contact"] ?? (() => null);

  const getEmpresa = useContactCatalogStore((s) => s.getEmpresaContacts);
  const getMy = useContactCatalogStore((s) => s.getMyContacts);
  const getSucursal = useContactCatalogStore((s) => s.getSucursalContacts);
  const catalogItems = useContactCatalogStore((s) => s.items);
  const negocios = useNegocioStore((s) => s.items);

  const getter =
    mode === "mios" ? getMy : mode === "sucursal" ? getSucursal : getEmpresa;

  const contactos = useMemo(() => {
    return getter();
  }, [getter, catalogItems, negocios, mode]);

  // pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 9;
  const totalPages = Math.max(1, Math.ceil(contactos.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;

    return contactos.slice(start, start + pageSize);
  }, [contactos, page]);

  useEffect(() => {
    setPage(1);
  }, [mode]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paged.map((c) => (
          <Card
            key={c.id}
            isPressable
            className={cards({ border: true })}
            onPress={() => pressAction && pressAction(c.id)}
          >
            <CardBody className="p-0">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex gap-2 items-start">
                    <div className="relative min-w-12">
                      <Tooltip content="Contacto">
                        <Icons.contact className="size-12 text-warning" />
                      </Tooltip>
                    </div>
                    <div>
                      <h3 className="font-bold text-large text-pretty">
                        {c.nombre}
                      </h3>
                      <div className="text-sm text-default-500">
                        {c.alias ||
                          (c.negocioId
                            ? (negocios.find((n) => n.id === c.negocioId)
                                ?.nombre ?? "")
                            : "")}
                      </div>
                    </div>
                  </div>

                  <div className="relative min-w-8">
                    <Tooltip content="Ver">
                      <CardIconComp className="size-8 text-warning" />
                    </Tooltip>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Chip size="sm" variant="bordered">
                    {(c as any).tipo ?? "OTRO"}
                  </Chip>
                  {(c as any).telefono && (
                    <Chip size="sm" variant="bordered">
                      {(c as any).telefono}
                    </Chip>
                  )}
                  {(c as any).correo && (
                    <Chip size="sm" variant="bordered">
                      {(c as any).correo}
                    </Chip>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {contactos.length === 0 && (
        <Card className={cards({ border: true })}>
          <CardBody className="text-center py-6">
            <p className="text-default-500">No se encontraron contactos</p>
          </CardBody>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex w-full justify-center pt-12">
          <Pagination
            isCompact
            showControls
            showShadow
            classNames={{
              wrapper: "shadow-xl",
              item: "cursor-pointer font-semibold",
            }}
            color="warning"
            page={page}
            siblings={0}
            size="lg"
            total={totalPages}
            onChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
};

export default ContactosList;
