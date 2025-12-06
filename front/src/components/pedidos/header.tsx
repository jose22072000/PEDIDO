import { Avatar, Chip } from "@heroui/react";

import Icons from "../icons/iconify";

import { useAuthStore } from "@/stores/authStore";

export const CrearPedidoHeader = () => {
  const auth = useAuthStore();

  return (
    <div className="w-full mb-8 flex items-start justify-between gap-6">
      <div className="flex flex-col gap-2">
        <h3>Cliente</h3>
        {auth.user && (
          <div className="flex flex-row gap-4 items-center">
            <Avatar
              isBordered
              className="size-14 md:size-16"
              color="warning"
              icon={<Icons.partners className="size-12" />}
              radius="md"
              size="md"
            />
            <div className="flex flex-col gap-1">
              <h2 className="text-lg md:text-2xl font-bold">
                Rigoberto Fernández
              </h2>
              <Chip color="warning" size="sm" variant="bordered">
                TCP KANGA
              </Chip>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3>Vendedor</h3>
        {auth.user && (
          <div className="flex flex-row gap-4 items-center">
            <Avatar
              isBordered
              className="size-14 md:size-16"
              color="warning"
              icon={<Icons.workers className="size-12" />}
              radius="md"
              size="md"
            />
            <div className="flex flex-col gap-1">
              <h2 className="text-lg md:text-2xl font-bold">
                {auth.user.username}
              </h2>
              <Chip color="warning" size="sm" variant="bordered">
                {auth.user.role || "Usuario"}
              </Chip>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
