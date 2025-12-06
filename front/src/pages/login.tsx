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
  correo: z
    .string()
    .min(1, "El correo electrónico es requerido")
    .email("Debe ser un correo electrónico válido"),
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
  const [userData, setUserData] = React.useState<{
    nombre: string;
    correo: string;
    rol?: string;
  } | null>(null);
  const [isClosingSession, setIsClosingSession] = React.useState(false);
  const [isLoadingSession, setIsLoadingSession] = React.useState(true);

  React.useEffect(() => {
    const loadSession = async () => {
      setIsLoadingSession(true);
      await auth.loadSession();
      setIsLoadingSession(false);
    };

    loadSession();
  }, []); // Solo cargar al montar el componente

  React.useEffect(() => {
    // Limpiar userData cuando no hay autenticación
    if (!auth.isAuthenticated) {
      setUserData(null);

      return;
    }

    // Si hay sesión autenticada, cargar datos del trabajador
    if (auth.session) {
      // Usar datos de la sesión local primero
      if (auth.session.trabajadorNombre && auth.session.usuarioId) {
        setUserData({
          nombre: auth.session.trabajadorNombre,
          correo: auth.session.usuarioId,
          rol: auth.session.rol,
        });
      }

      // Intentar obtener datos actualizados del backend si hay conexión
      const fetchUserData = async () => {
        try {
          const response = await fetch(`http://localhost:3400/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${auth.session?.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();

            setUserData({
              nombre: data.trabajador.nombre,
              correo: data.usuario.correo,
              rol: data.trabajador.rol,
            });

            // Actualizar la sesión con los datos más recientes
            if (auth.session) {
              await auth.setSession({
                ...auth.session,
                trabajadorId: data.trabajador.email,
                trabajadorNombre: data.trabajador.nombre,
                usuarioId: data.usuario.correo,
                rol: data.trabajador.rol,
              });
            }
          } else if (response.status === 401) {
            // Token inválido o expirado, cerrar sesión
            await auth.clearSession();
            setUserData(null);
          }
        } catch (error) {
          // Sin conexión, mantener datos de la sesión local
        }
      };

      fetchUserData();
    }
  }, [auth.isAuthenticated, auth.session?.token]);

  const toggleVisibility = () => setIsVisible(!isVisible);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: "all",
  });

  const onSubmit = async (data: LoginFormData) => {
    const res = await auth.login(data.correo, data.password);

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
      await auth.clearSession();
      // Forzar la limpieza del estado local inmediatamente
      setUserData(null);
      setMessage(null);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error cerrando sesión:", error);
    } finally {
      setIsClosingSession(false);
    }
  };

  // Mostrar loading mientras se carga la sesión inicial
  if (isLoadingSession) {
    return (
      <DefaultLayout>
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-4">
            <Icons.shield className="size-24 text-warning animate-pulse" />
            <h2 className="text-2xl font-bold text-warning">PROCOVAR</h2>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-warning" />
            <p className="text-default-500">Cargando sesión...</p>
          </div>
        </div>
      </DefaultLayout>

    );
  }

  if (auth.isAuthenticated && userData) {
    return (
      <DefaultLayout>
        <div className="flex justify-center">
          <div className="rounded-large bg-content1 shadow-small flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-8 md:pt-6 md:pb-10">
            <div className="flex flex-row gap-3 items-center mb-6">
              <Avatar
                className="size-14 md:size-16"
                color="warning"
                icon={<Icons.workers className="size-8" />}
                size="lg"
              />
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-bold">{userData.nombre}</h2>
                <Chip color="warning" size="sm" variant="bordered">
                  {userData.rol}
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
                  color="warning"
                  href="/panel"
                  size="lg"
                  startContent={<Icons.panel className="size-8" />}
                  variant="shadow"
                >
                  Ir al Panel
                </Button>
                <Button
                  className="col-span-2 btn"
                  color="danger"
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
            <Icons.shield className="pointer-events-none size-14 md:size-16" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">Inicia sesión en tu cuenta</h1>
              <p className="text-sm text-default-500">
                Introduzca sus datos de acceso
              </p>
            </div>
          </div>

          <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)}>
            {message && (
              <div
                className={`p-3 rounded-lg text-sm ${message.type === "success"
                  ? "bg-success-50 text-success-700"
                  : "bg-danger-50 text-danger-700"
                  }`}
              >
                {message.text}
              </div>
            )}
            {errors.root && (
              <div className="text-danger text-small">{errors.root.message}</div>
            )}
            <Input
              {...register("correo")}
              errorMessage={errors.correo?.message}
              isInvalid={!!errors.correo}
              label="Correo Electrónico"
              placeholder="Ingresa tu correo electrónico"
              size="lg"
              type="email"
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
                placeholder="Ingresa tu contraseña"
                size="lg"
                type={isVisible ? "text" : "password"}
                variant="bordered"
              />

              <div className="flex justify-end">
                <Link
                  className="cursor-pointer hover:underline"
                  color="warning"
                  href="/forgot-password"
                  size="sm"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>

            <Button
              className="w-full btn"
              color="warning"
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
