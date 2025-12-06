import React from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input, Button, Link } from "@heroui/react";

import { useAuthStore } from "@/stores/authStore";
import Icons from "@/components/icons/iconify";
import DefaultLayout from "@/layouts/default";
const {
  mailInbox: FluentMailInboxArrowDown20Filled,
  rewind: SolarRewindBackCircleLinear,
  mailOutgoing: StreamlinePlumpMailOutgoing,
} = Icons;

const schema = z.object({ email: z.string().email("Correo inválido") });

type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const auth = useAuthStore();
  const [message, setMessage] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    if (!online) {
      setMessage({
        type: "error",
        text: "No hay conexión. Intenta cuando tengas conexión.",
      });

      return;
    }
    const res = await auth.requestPasswordReset(data.email);

    if (res.ok) {
      setMessage({
        type: "success",
        text: "Se ha enviado un código OTP a tu correo.",
      });
      setTimeout(() => {
        navigate(`/reset-password?email=${encodeURIComponent(data.email)}`);
      }, 1500);
    } else {
      setMessage({
        type: "error",
        text: res.error || "Error al enviar el código",
      });
    }
  };

  return (
    <DefaultLayout>
      <div className="flex justify-center">
        <div className="rounded-large bg-content1 shadow-small flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-8 md:pt-6 md:pb-10">
          <div className="flex flex-row gap-3 items-center mb-6">
            <StreamlinePlumpMailOutgoing className="pointer-events-none size-14 md:size-16" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
              <p className="text-sm text-default-500">
                Ingresa tu correo para recibir un código OTP
              </p>
            </div>
          </div>
          {message && (
            <div
              className={`p-3 rounded-lg text-sm mb-4 ${
                message.type === "success"
                  ? "bg-success-50 text-success-700"
                  : "bg-danger-50 text-danger-700"
              }`}
            >
              {message.text}
            </div>
          )}
          <form
            className="flex flex-col gap-6"
            onSubmit={handleSubmit(onSubmit)}
          >
            <Input
              {...register("email")}
              errorMessage={errors.email?.message}
              isInvalid={!!errors.email}
              label="Correo Electrónico"
              placeholder="correo@gmail.com"
              size="lg"
              variant="bordered"
            />
            <Button
              className="btn"
              color="primary"
              isDisabled={!online || isSubmitting}
              isLoading={isSubmitting}
              size="lg"
              startContent={
                !isSubmitting && (
                  <FluentMailInboxArrowDown20Filled className="size-8" />
                )
              }
              type="submit"
            >
              Recuperar Contraseña
            </Button>
            <div className="flex justify-start pt-2">
              <Link
                className="cursor-pointer hover:underline flex items-center gap-1 font-semibold"
                color="primary"
                href="/"
                size="sm"
              >
                <SolarRewindBackCircleLinear />
                Volver al inicio de sesión
              </Link>
            </div>
          </form>
          {!online && (
            <div className="p-3 rounded-lg text-sm mt-3 bg-primary-50 text-primary-700">
              Necesitas conexión para solicitar el código
            </div>
          )}
        </div>
      </div>
    </DefaultLayout>
  );
}
