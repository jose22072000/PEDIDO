import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, Chip, Pagination, Tooltip } from "@heroui/react";

import { cards } from "../primitives";

import useNegocioCatalogStore from "@/stores/negocioCatalogStore";
import { useTrabajadorStore } from "@/stores/entityStores";
import Icons from "@/components/icons/iconify";

export const NegocioList = ({
  pressAction,
}: {
  pressAction?: (id?: string) => void;
}) => {
  const filteredItems = useNegocioCatalogStore((s) => s.filteredItems);
  const filter = useNegocioCatalogStore((s) => s.filter);
  const trabajadores = useTrabajadorStore((s) => s.items);

  // Catalog ahora viene directamente del store
  const catalog = filteredItems;

  const [page, setPage] = useState(1);
  const pageSize = 9;
  const totalPages = Math.max(1, Math.ceil(catalog.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;

    return catalog.slice(start, start + pageSize);
  }, [catalog, page]);

  useEffect(() => setPage(1), [filter]);

  const CardIconComp: any = Icons.store ?? Icons.locales ?? (() => null);

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paged.map((n) => {
          const trabajador = trabajadores.find(
            (t) => t.email === n.trabajadorAsignado,
          );

          return (
            <Card
              key={n.id}
              isPressable
              className={cards({ border: true })}
              onPress={() => pressAction && pressAction(n.id)}
            >
              <CardBody className="p-0">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex gap-1 items-start">
                      <div className="relative min-w-12">
                        <Tooltip content="Negocio">
                          <span>
                            <CardIconComp className="size-12 text-primary" />
                          </span>
                        </Tooltip>
                      </div>
                      <h3 className="font-bold text-large text-pretty">
                        {n.nombre}
                      </h3>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {n.alias && (
                      <Chip size="sm" variant="bordered">
                        {n.alias}
                      </Chip>
                    )}
                    <div className="text-sm text-default-500">
                      {n.direccion || "-"}
                    </div>
                    {(n.provincia || n.municipio || n.reparto) && (
                      <div className="text-xs text-default-400 flex flex-wrap gap-1">
                        {n.provincia && <span>{n.provincia}</span>}
                        {n.municipio && <span>• {n.municipio}</span>}
                        {n.reparto && <span>• {n.reparto}</span>}
                      </div>
                    )}
                    {n.coordenadas && (
                      <div className="text-xs text-default-400">
                        📍 {n.coordenadas}
                      </div>
                    )}
                    <div>
                      {trabajador ? (
                        <Chip color="primary" size="sm" variant="flat">
                          {trabajador.nombre}
                        </Chip>
                      ) : (
                        <Chip size="sm" variant="bordered">
                          Sin asignar
                        </Chip>
                      )}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {catalog.length === 0 && (
        <Card className={cards({ border: true })}>
          <CardBody className="text-center py-6">
            <p className="text-default-500">No se encontraron negocios</p>
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
              wrapper: "shadow-xl shadow-primary/5",
              item: "cursor-pointer font-semibold",
            }}
            color="primary"
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

export default NegocioList;
