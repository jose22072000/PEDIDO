import React from "react";
import { Button, Input, Link, Avatar, Alert, Chip } from "@heroui/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";

import Icons from "@/components/icons/iconify";
import { useAuthStore } from "@/stores/authStore";
import DefaultLayout from "@/layouts/default";

// Zod schema for login validation
const loginSchema = z.object({
  usuario: z.string().min(1, "El usuario es requerido"),
  password: z
    .string()
    .min(1, "La contraseña es requerida")
    .min(6, "La contraseña debe tener al menos 6 caracteres"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [isVisible, setIsVisible] = React.useState(false);
  const navigate = useNavigate();
  const auth = useAuthStore();
  const [message, setMessage] = React.useState<{
    type: "success" | "error" | null;
    text?: string;
  } | null>(null);
  const [isClosingSession, setIsClosingSession] = React.useState(false);

  React.useEffect(() => {
    const loadSession = async () => {
      await auth.loadSession();
    };

    loadSession();
  }, []);

  const toggleVisibility = () => setIsVisible(!isVisible);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    const res = await auth.login(data.usuario, data.password);

    if (res.ok) {
      setMessage({
        type: "success",
        text: "Inicio de sesión correcto. Redirigiendo...",
      });
      setTimeout(() => navigate("/panel"), 500);
    } else {
      setMessage({
        type: "error",
        text: res.error || "Credenciales inválidas",
      });
    }
  };

  const handleCerrarSesion = async () => {
    setIsClosingSession(true);
    try {
      await auth.logout();
      setMessage(null);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error cerrando sesión:", error);
    } finally {
      setIsClosingSession(false);
    }
  };

  // Mostrar loading mientras se carga la sesión inicial
  if (auth.isLoading) {
    return (
      <DefaultLayout>
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-4">
            <Icons.shield className="size-24 text-primary animate-pulse" />
            <h2 className="text-2xl font-bold text-primary">PROCOVAR</h2>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        </div>
      </DefaultLayout>
    );
  }

  if (auth.isAuthenticated && auth.user) {
    return (
      <DefaultLayout>
        <div className="flex justify-center">
          <div className="rounded-large bg-content1 shadow-small flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-8 md:pt-6 md:pb-10">
            <div className="flex flex-row gap-3 items-center mb-6">
              <Avatar
                className="size-14 md:size-16"
                color="primary"
                icon={<Icons.workers className="size-8" />}
                size="lg"
              />
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-bold">{auth.user.username}</h2>
                <Chip color="primary" size="sm" variant="bordered">
                  {auth.user.role || "Usuario"}
                </Chip>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Alert
                color="success"
                description={`Presiona el botón para ir al panel de control`}
                title="Sesión activa"
                variant="flat"
              />
              <div className="grid grid-cols-5 gap-2">
                <Button
                  as={Link}
                  className="col-span-3 btn"
                  color="primary"
                  href="/panel"
                  size="lg"
                  startContent={<Icons.panel className="size-8" />}
                  variant="shadow"
                >
                  Ir al Panel
                </Button>
                <Button
                  className="col-span-2 btn"
                  isDisabled={isClosingSession}
                  isLoading={isClosingSession}
                  size="lg"
                  variant="ghost"
                  onPress={handleCerrarSesion}
                >
                  Cerrar Sesión
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DefaultLayout>
    );
  }

  return (
    <DefaultLayout>
      <div className="flex justify-center">
        <div className="rounded-large bg-content1 shadow-small flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-8 md:pt-6 md:pb-10">
          <div className="flex flex-row gap-3 items-center mb-6">
            <Icons.shield className="pointer-events-none size-14 md:size-16 text-primary" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-primary">
                Inicia sesión en tu cuenta
              </h1>
              <p className="text-sm text-default-500">
                Introduzca sus datos de acceso
              </p>
            </div>
          </div>

          <form
            className="flex flex-col gap-6"
            onSubmit={handleSubmit(onSubmit)}
          >
            {message && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  message.type === "success"
                    ? "bg-success-50 text-success-700"
                    : "bg-danger-50 text-danger-700"
                }`}
              >
                {message.text}
              </div>
            )}
            {errors.root && (
              <div className="text-danger text-small">
                {errors.root.message}
              </div>
            )}
            <Input
              {...register("usuario")}
              errorMessage={errors.usuario?.message}
              isInvalid={!!errors.usuario}
              label="Usuario"
              size="lg"
              type="text"
              variant="bordered"
            />
            <div className="flex flex-col gap-2">
              <Input
                {...register("password")}
                endContent={
                  <button type="button" onClick={toggleVisibility}>
                    {isVisible ? (
                      <Icons.eyeClosed className="text-foreground-500 pointer-events-none text-2xl" />
                    ) : (
                      <Icons.eye className="text-foreground-500 pointer-events-none text-2xl" />
                    )}
                  </button>
                }
                errorMessage={errors.password?.message}
                isInvalid={!!errors.password}
                label="Contraseña"
                size="lg"
                type={isVisible ? "text" : "password"}
                variant="bordered"
              />
            </div>

            <Button
              className="w-full btn"
              color="primary"
              isDisabled={isSubmitting}
              isLoading={isSubmitting}
              size="lg"
              startContent={
                !isSubmitting && <Icons.fingerprint className="size-8" />
              }
              type="submit"
              variant="shadow"
            >
              Acceder al Sistema
            </Button>
          </form>
        </div>
      </div>
    </DefaultLayout>
  );
}
