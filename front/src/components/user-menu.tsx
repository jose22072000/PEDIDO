import { useState } from "react";
import {
  Avatar,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Button,
} from "@heroui/react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/authStore";
import { getApiBaseUrl } from "@/config";

/**
 * Menú de perfil (avatar): muestra QUIÉN eres y con qué cuenta entraste, deja
 * CAMBIAR TU PROPIA contraseña y cerrar sesión. Va en el encabezado (todas las vistas).
 */
export const UserMenu = () => {
  const { user, session, logout } = useAuthStore();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const username = user?.username || "usuario";
  const rol = user?.role || session?.rol || "";
  const inicial = username.slice(0, 1).toUpperCase();

  const cerrarSesion = async () => {
    await logout();
    navigate("/");
  };

  const guardar = async () => {
    setError(null);
    setOk(null);
    if (!actual || !nueva) {
      setError("Completa la contraseña actual y la nueva.");

      return;
    }
    if (nueva.length < 6) {
      setError("La nueva debe tener al menos 6 caracteres.");

      return;
    }
    if (nueva !== confirmar) {
      setError("La nueva y la confirmación no coinciden.");

      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: actual, newPassword: nueva }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(data?.error || "No se pudo cambiar la contraseña.");
      } else {
        setOk("Contraseña actualizada.");
        setActual("");
        setNueva("");
        setConfirmar("");
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <Avatar
            isBordered
            as="button"
            className="cursor-pointer"
            color="primary"
            name={inicial}
            size="sm"
          />
        </DropdownTrigger>
        <DropdownMenu aria-label="Perfil">
          <DropdownItem key="quien" textValue="quien">
            <div className="flex flex-col">
              <span className="text-xs text-default-500">Conectado como</span>
              <span className="font-semibold">{username}</span>
              {rol ? <span className="text-xs text-default-400">{rol}</span> : null}
            </div>
          </DropdownItem>
          <DropdownItem
            key="password"
            onPress={() => {
              setError(null);
              setOk(null);
              setOpen(true);
            }}
          >
            🔑 Cambiar contraseña
          </DropdownItem>
          <DropdownItem
            key="logout"
            className="text-danger"
            color="danger"
            onPress={cerrarSesion}
          >
            Cerrar sesión
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      <Modal isDismissable={false} isOpen={open} placement="center" onClose={() => setOpen(false)}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Cambiar mi contraseña</ModalHeader>
              <ModalBody className="gap-3">
                {error && (
                  <div className="bg-danger-50 border-l-4 border-danger p-2 rounded text-sm text-danger-700">
                    {error}
                  </div>
                )}
                {ok && (
                  <div className="bg-success-50 border-l-4 border-success p-2 rounded text-sm text-success-700">
                    {ok}
                  </div>
                )}
                <Input
                  label="Contraseña actual"
                  type="password"
                  value={actual}
                  variant="bordered"
                  onChange={(e) => setActual(e.target.value)}
                />
                <Input
                  label="Nueva contraseña"
                  type="password"
                  value={nueva}
                  variant="bordered"
                  onChange={(e) => setNueva(e.target.value)}
                />
                <Input
                  label="Confirmar nueva"
                  type="password"
                  value={confirmar}
                  variant="bordered"
                  onChange={(e) => setConfirmar(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" onPress={onClose}>
                  Cerrar
                </Button>
                <Button color="primary" isLoading={loading} onPress={guardar}>
                  Guardar
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};
