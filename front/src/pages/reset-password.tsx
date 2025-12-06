import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input, Button, Link } from "@heroui/react";

import { useAuthStore } from "@/stores/authStore";
import Icons from "@/components/icons/iconify";
import DefaultLayout from "@/layouts/default";
const {
  checkDouble: MeteorIconsCheckDouble,
  keySquare: SolarKeyMinimalisticSquare2Linear,
  rewind: SolarRewindBackCircleLinear,
} = Icons;

const schema = z
  .object({
    email: z.string().email(),
    code: z.string().min(6, "Código inválido").max(6, "Código inválido"),
    password: z
      .string()
      .min(6, "La contraseña debe tener al menos 6 caracteres"),
    confirm: z.string().min(6),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Las contraseñas no coinciden",
    path: ["confirm"],
  });

type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuthStore();
  const [message, setMessage] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Read email from search params
  const emailFromParam = (searchParams.get("email") || "").trim();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: emailFromParam },
  });

  const onSubmit = async (data: FormData) => {
    const res = await auth.resetPassword(data.email, data.code, data.password);

    if (res.ok) {
      setMessage({
        type: "success",
        text: "Contraseña actualizada correctamente. Ahora puedes iniciar sesión.",
      });
      setTimeout(() => navigate("/"), 1500);
    } else {
      setMessage({
        type: "error",
        text: res.error || "Error al restablecer contraseña",
      });
    }
  };

  return (
    <DefaultLayout>
      <div className="flex justify-center">
        <div className="rounded-large bg-content1 shadow-small flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-8 md:pt-6 md:pb-10">
          <div className="flex flex-row gap-3 items-center mb-6">
            <SolarKeyMinimalisticSquare2Linear className="pointer-events-none size-14 md:size-16" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">Restablecer contraseña</h1>
              <p className="text-sm text-default-500">
                Ingresa el código recibido y la nueva contraseña
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
            className="flex flex-col gap-4"
            onSubmit={handleSubmit(onSubmit)}
          >
            <Input
              {...register("email")}
              readOnly
              errorMessage={errors.email?.message}
              isInvalid={!!errors.email}
              label="Correo"
              placeholder="correo@ejemplo.com"
              size="lg"
              variant="bordered"
            />
            <Input
              {...register("code")}
              errorMessage={errors.code?.message}
              isInvalid={!!errors.code}
              label="Código OTP"
              size="lg"
              variant="bordered"
            />
            <Input
              {...register("password")}
              errorMessage={errors.password?.message}
              isInvalid={!!errors.password}
              label="Nueva contraseña"
              size="lg"
              type="password"
              variant="bordered"
            />
            <Input
              {...register("confirm")}
              errorMessage={errors.confirm?.message}
              isInvalid={!!errors.confirm}
              label="Confirmar contraseña"
              size="lg"
              type="password"
              variant="bordered"
            />
            <Button
              color="warning"
              isLoading={isSubmitting}
              size="lg"
              startContent={
                !isSubmitting && <MeteorIconsCheckDouble className="size-8" />
              }
              type="submit"
            >
              Restablecer
            </Button>
          </form>
          <div className="flex justify-start pt-2">
            <Link
              className="cursor-pointer hover:underline flex items-center gap-1 font-semibold"
              color="warning"
              href="/"
              size="sm"
            >
              <SolarRewindBackCircleLinear />
              Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    </DefaultLayout>
  );
}
