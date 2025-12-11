import { Button, Card, CardBody } from "@heroui/react";
import { useNavigate } from "react-router-dom";

import Icons from "@/components/icons/iconify";
import DefaultLayout from "@/layouts/default";

export default function UnauthorizedPage() {
  const navigate = useNavigate();

  return (
    <DefaultLayout>
      <section className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-xl w-full">
          <CardBody className="gap-6 py-8 px-6 text-center">
            <div className="flex justify-center">
              <div className="bg-danger-50 rounded-full p-4">
                <Icons.close className="size-16 text-danger" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-danger">
                Acceso Denegado
              </h1>
              <p className="text-default-500">
                No tienes los permisos necesarios para acceder a esta página.
              </p>
              <p className="text-sm text-default-400">
                Si crees que esto es un error, contacta con el administrador del
                sistema.
              </p>
            </div>

            <div className="flex gap-3 justify-center pt-4">
              <Button
                color="default"
                variant="flat"
                onPress={() => navigate(-1)}
              >
                Volver Atrás
              </Button>
              <Button color="primary" onPress={() => navigate("/panel")}>
                Ir al Panel
              </Button>
            </div>
          </CardBody>
        </Card>
      </section>
    </DefaultLayout>
  );
}
