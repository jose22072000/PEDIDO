import { Card, CardBody, Input, Textarea, Button } from "@heroui/react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

import { useNegocioStore } from "@/stores/entityStores";
import { useAuthStore } from "@/stores/authStore";
import { cards } from "@/components/primitives";
import { NavigationHeading } from "@/components/navigation-heading";

const NuevoNegocioSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  alias: z.string().optional(),
  direccion: z.string().min(1, "La dirección es requerida"),
  provincia: z.string().optional(),
  municipio: z.string().optional(),
  reparto: z.string().optional(),
  coordenadas: z.string().optional(),
  descripcion: z.string().optional(),
});

type NuevoNegocioForm = z.infer<typeof NuevoNegocioSchema>;

export default function NuevoNegocioPage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createNegocio = useNegocioStore((s) => s.create);
  const user = useAuthStore((s) => s.user);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<NuevoNegocioForm>({
    resolver: zodResolver(NuevoNegocioSchema),
    defaultValues: {
      nombre: "",
      alias: "",
      direccion: "",
      provincia: "",
      municipio: "",
      reparto: "",
      coordenadas: "",
      descripcion: "",
    },
  });

  const onSubmit = async (data: NuevoNegocioForm) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Generate ID manually since create expects it
      const id = crypto.randomUUID();
      const now = Date.now();

      const negocioData = {
        id,
        createdAt: now,
        updatedAt: now,
        nombre: data.nombre,
        direccion: data.direccion,
        provincia: data.provincia || undefined,
        municipio: data.municipio || undefined,
        reparto: data.reparto || undefined,
        coordenadas: data.coordenadas || undefined,
        descripcion: data.descripcion || undefined,
        alias: data.alias || undefined,
        trabajadorAsignado: user?.id, // Siempre el usuario autenticado
        lat: undefined,
        lng: undefined,
      };

      await createNegocio(negocioData);
      navigate("/panel/panel-negocio");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al crear el negocio",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <NavigationHeading
        cta={{ href: "/panel/panel-negocio", label: "Volver a Negocios" }}
        icon="add"
        paragraph="Registra un nuevo negocio en el sistema"
        title="Nuevo Negocio"
      />

      <Card className={cards({ border: true })}>
        <CardBody className="gap-6">
          <form
            className="flex flex-col gap-6"
            onSubmit={handleSubmit(onSubmit)}
          >
            {/* Información básica */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Controller
                control={control}
                name="nombre"
                render={({ field }) => (
                  <Input
                    {...field}
                    isRequired
                    errorMessage={errors.nombre?.message}
                    isInvalid={!!errors.nombre}
                    label="Nombre del negocio"
                    placeholder="Ej: Bodega La Esquina"
                    variant="bordered"
                  />
                )}
              />

              <Controller
                control={control}
                name="alias"
                render={({ field }) => (
                  <Input
                    {...field}
                    label="Alias (opcional)"
                    placeholder="Ej: La Esquina"
                    variant="bordered"
                  />
                )}
              />
            </div>

            {/* Ubicación */}
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold">Ubicación</h3>

              <Controller
                control={control}
                name="direccion"
                render={({ field }) => (
                  <Input
                    {...field}
                    isRequired
                    errorMessage={errors.direccion?.message}
                    isInvalid={!!errors.direccion}
                    label="Dirección"
                    placeholder="Ej: Calle 23 #456 entre A y B"
                    variant="bordered"
                  />
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Controller
                  control={control}
                  name="provincia"
                  render={({ field }) => (
                    <Input
                      {...field}
                      label="Provincia"
                      placeholder="Ej: La Habana"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="municipio"
                  render={({ field }) => (
                    <Input
                      {...field}
                      label="Municipio"
                      placeholder="Ej: Plaza de la Revolución"
                      variant="bordered"
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="reparto"
                  render={({ field }) => (
                    <Input
                      {...field}
                      label="Reparto"
                      placeholder="Ej: Vedado"
                      variant="bordered"
                    />
                  )}
                />
              </div>

              <Controller
                control={control}
                name="coordenadas"
                render={({ field }) => (
                  <Input
                    {...field}
                    description="Formato: latitud,longitud"
                    label="Coordenadas (opcional)"
                    placeholder="Ej: 23.1136, -82.3666"
                    variant="bordered"
                  />
                )}
              />
            </div>

            {/* Descripción */}
            <Controller
              control={control}
              name="descripcion"
              render={({ field }) => (
                <Textarea
                  {...field}
                  label="Descripción (opcional)"
                  minRows={3}
                  placeholder="Notas adicionales sobre el negocio..."
                  variant="bordered"
                />
              )}
            />

            {/* Error message */}
            {error && (
              <div className="text-danger text-sm p-3 bg-danger-50 rounded-lg">
                {error}
              </div>
            )}

            {/* Acciones */}
            <div className="flex gap-3 justify-end">
              <Button
                isDisabled={isSubmitting}
                variant="flat"
                onPress={() => navigate("/panel/negocios")}
              >
                Cancelar
              </Button>
              <Button color="primary" isLoading={isSubmitting} type="submit">
                Crear Negocio
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
