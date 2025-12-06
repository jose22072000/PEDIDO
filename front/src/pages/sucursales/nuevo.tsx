import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardBody, Input, Button, Switch } from "@heroui/react";

import { NavigationHeading } from "@/components/navigation-heading";
import { useSucursalStore } from "@/stores/entityStores";
import { useAuthStore } from "@/stores/authStore";

const NuevaSucursalSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  codigo: z.string().min(1, "El código es requerido"),
  ciudad: z.string().min(1, "La ciudad es requerida"),
  direccion: z.string().optional(),
  activo: z.boolean(),
});

type NuevaSucursalForm = z.infer<typeof NuevaSucursalSchema>;

export default function NuevaSucursalPage() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const { create: createOne } = useSucursalStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verificar permisos administrativos
  const isAdmin = session?.rol === "ADMIN" || session?.rol === "DIRECTIVO";

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<NuevaSucursalForm>({
    resolver: zodResolver(NuevaSucursalSchema),
    defaultValues: {
      nombre: "",
      codigo: "",
      ciudad: "",
      activo: true,
      direccion: "",
    },
  });

  const onSubmit = async (data: NuevaSucursalForm) => {
    if (!isAdmin) {
      setError("No tienes permisos para crear sucursales");

      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const id = crypto.randomUUID();
      const now = Date.now();

      await createOne({
        id,
        ...data,
        createdAt: now,
        updatedAt: now,
      });

      navigate("/panel/panel-sucursal/visualizar");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al crear la sucursal",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <section className="flex flex-col gap-6 p-4">
        <NavigationHeading
          cta={{ href: "/panel/panel-sucursal", label: "Volver a Sucursales" }}
          icon="building"
          paragraph="No tienes permisos para acceder a esta página"
          title="Nueva Sucursal"
        />
        <Card>
          <CardBody>
            <p className="text-danger">
              Solo usuarios administrativos pueden crear sucursales.
            </p>
          </CardBody>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6 p-4">
      <NavigationHeading
        cta={{ href: "/panel/panel-sucursal", label: "Volver a Sucursales" }}
        icon="add"
        paragraph="Registra una nueva sucursal en el sistema"
        title="Nueva Sucursal"
      />

      <Card>
        <CardBody>
          <form
            className="flex flex-col gap-6"
            onSubmit={handleSubmit(onSubmit)}
          >
            {error && (
              <div className="bg-danger-50 border border-danger-200 text-danger-800 px-4 py-3 rounded">
                {error}
              </div>
            )}

            {/* Información básica */}
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold">Información Básica</h3>

              <Controller
                control={control}
                name="nombre"
                render={({ field }) => (
                  <Input
                    {...field}
                    isRequired
                    errorMessage={errors.nombre?.message}
                    isInvalid={!!errors.nombre}
                    label="Nombre"
                    placeholder="Ej: Sucursal Centro"
                    variant="bordered"
                  />
                )}
              />

              <Controller
                control={control}
                name="codigo"
                render={({ field }) => (
                  <Input
                    {...field}
                    isRequired
                    errorMessage={errors.codigo?.message}
                    isInvalid={!!errors.codigo}
                    label="Código"
                    placeholder="Ej: SUC-001"
                    variant="bordered"
                  />
                )}
              />

              <Controller
                control={control}
                name="ciudad"
                render={({ field }) => (
                  <Input
                    {...field}
                    isRequired
                    errorMessage={errors.ciudad?.message}
                    isInvalid={!!errors.ciudad}
                    label="Ciudad"
                    placeholder="Ej: La Habana"
                    variant="bordered"
                  />
                )}
              />

              <Controller
                control={control}
                name="direccion"
                render={({ field }) => (
                  <Input
                    {...field}
                    errorMessage={errors.direccion?.message}
                    isInvalid={!!errors.direccion}
                    label="Dirección"
                    placeholder="Dirección completa (opcional)"
                    variant="bordered"
                  />
                )}
              />

              <Controller
                control={control}
                name="activo"
                render={({ field }) => (
                  <Switch
                    isSelected={field.value}
                    onValueChange={field.onChange}
                  >
                    Sucursal activa
                  </Switch>
                )}
              />
            </div>

            <div className="flex gap-4 justify-end">
              <Button
                color="default"
                variant="flat"
                onPress={() => navigate("/panel/panel-sucursal")}
              >
                Cancelar
              </Button>
              <Button color="warning" isLoading={isSubmitting} type="submit">
                Crear Sucursal
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
