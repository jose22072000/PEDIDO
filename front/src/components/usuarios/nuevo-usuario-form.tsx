import {
  Card,
  CardBody,
  CardHeader,
  Input,
  Button,
  Select,
  SelectItem,
} from "@heroui/react";
import { useForm, Controller } from "react-hook-form";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import Icons from "../icons/iconify";

import { cards } from "@/components/primitives";
import { getApiBaseUrl } from "@/config";

interface Rol {
  id: string;
  nombre: string;
}

interface Sucursal {
  id: string;
  nombre: string;
}

interface UsuarioFormData {
  username: string;
  password: string;
  confirmPassword: string;
  rolId: string;
  sucursalId: string;
}

export const NuevoUsuarioForm = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] =
    useState(false);

  const togglePasswordVisibility = () =>
    setIsPasswordVisible(!isPasswordVisible);
  const toggleConfirmPasswordVisibility = () =>
    setIsConfirmPasswordVisible(!isConfirmPasswordVisible);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    control,
  } = useForm<UsuarioFormData>();

  const password = watch("password");

  useEffect(() => {
    fetchRoles();
    fetchSucursales();
  }, []);

  const fetchRoles = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/roles`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();

        setRoles(data);
      }
    } catch (err) {
      // Error fetching roles
    }
  };

  const fetchSucursales = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/sucursales`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();

        setSucursales(data);
      }
    } catch (err) {
      // Error fetching sucursales
    }
  };

  const onSubmit = async (data: UsuarioFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          rolId: data.rolId,
          sucursalId: data.sucursalId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        throw new Error(errorData.error || "Error al crear usuario");
      }

      setSuccess("Usuario creado correctamente");
      setTimeout(() => {
        navigate("/panel/panel-usuarios/lista");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className={cards()}>
      <CardHeader className="flex gap-3">
        <Icons.user className="size-6 text-primary" />
        <div className="flex flex-col">
          <p className="text-lg font-semibold">Datos del Usuario</p>
          <p className="text-small text-default-500">
            Completa la información requerida
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          {error && (
            <div className="bg-danger-50 border-l-4 border-danger p-4 rounded">
              <div className="flex items-center gap-2">
                <Icons.close className="size-5 text-danger" />
                <p className="text-sm text-danger-700">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-success-50 border-l-4 border-success p-4 rounded">
              <div className="flex items-center gap-2">
                <Icons.check className="size-5 text-success" />
                <p className="text-sm text-success-700">{success}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              {...register("username", {
                required: "El nombre de usuario es requerido",
                minLength: {
                  value: 3,
                  message: "Mínimo 3 caracteres",
                },
              })}
              className="md:col-span-2"
              errorMessage={errors.username?.message}
              isInvalid={!!errors.username}
              label="Nombre de Usuario"
              type="text"
              variant="bordered"
            />

            <Input
              {...register("password", {
                required: "La contraseña es requerida",
                minLength: {
                  value: 6,
                  message: "Mínimo 6 caracteres",
                },
              })}
              endContent={
                <button type="button" onClick={togglePasswordVisibility}>
                  {isPasswordVisible ? (
                    <Icons.eyeClosed className="text-foreground-500 pointer-events-none text-2xl" />
                  ) : (
                    <Icons.eye className="text-foreground-500 pointer-events-none text-2xl" />
                  )}
                </button>
              }
              errorMessage={errors.password?.message}
              isInvalid={!!errors.password}
              label="Contraseña"
              type={isPasswordVisible ? "text" : "password"}
              variant="bordered"
            />

            <Input
              {...register("confirmPassword", {
                required: "Confirme la contraseña",
                validate: (value) =>
                  value === password || "Las contraseñas no coinciden",
              })}
              endContent={
                <button type="button" onClick={toggleConfirmPasswordVisibility}>
                  {isConfirmPasswordVisible ? (
                    <Icons.eyeClosed className="text-foreground-500 pointer-events-none text-2xl" />
                  ) : (
                    <Icons.eye className="text-foreground-500 pointer-events-none text-2xl" />
                  )}
                </button>
              }
              errorMessage={errors.confirmPassword?.message}
              isInvalid={!!errors.confirmPassword}
              label="Confirmar Contraseña"
              type={isConfirmPasswordVisible ? "text" : "password"}
              variant="bordered"
            />

            <Controller
              control={control}
              name="rolId"
              render={({ field }) => (
                <Select
                  {...field}
                  errorMessage={errors.rolId?.message}
                  isInvalid={!!errors.rolId}
                  label="Rol"
                  selectedKeys={field.value ? [field.value] : []}
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string;

                    field.onChange(value);
                  }}
                >
                  {roles.map((rol) => (
                    <SelectItem key={rol.id}>{rol.nombre}</SelectItem>
                  ))}
                </Select>
              )}
              rules={{
                required: "Seleccione un rol",
              }}
            />

            <Controller
              control={control}
              name="sucursalId"
              render={({ field }) => (
                <Select
                  {...field}
                  errorMessage={errors.sucursalId?.message}
                  isInvalid={!!errors.sucursalId}
                  label="Sucursal"
                  selectedKeys={field.value ? [field.value] : []}
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string;

                    field.onChange(value);
                  }}
                >
                  {sucursales.map((sucursal) => (
                    <SelectItem key={sucursal.id}>{sucursal.nombre}</SelectItem>
                  ))}
                </Select>
              )}
              rules={{
                required: "Seleccione una sucursal",
              }}
            />
          </div>

          <div className="flex flex-col md:flex-row gap-4 justify-end">
            <Button
              size="lg"
              variant="bordered"
              onPress={() => navigate("/panel/panel-usuarios")}
            >
              Cancelar
            </Button>
            <Button
              color="primary"
              isLoading={isLoading}
              size="lg"
              startContent={<Icons.add className="size-5" />}
              type="submit"
            >
              Crear Usuario
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};
