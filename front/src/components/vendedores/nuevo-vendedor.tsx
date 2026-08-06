import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Select,
  SelectItem,
  Spinner,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";
import { mostrarUsuario } from "@/lib/nombre-usuario";
import { type Gestor } from "@/stores/datos/vendedores";

/**
 * Alta manual de un vendedor.
 *
 * Hasta ahora un vendedor solo nacía cuando llegaba su CSV desde Parranda, así
 * que el que no usa tablet sencillamente no existía y no había dónde meterle los
 * pedidos. Esto lo crea a mano.
 *
 * El detalle que importa: escribe en el MISMO sitio donde escribe la ingesta
 * automática. Si el nombre o el código quedaran un poco distintos de lo que
 * traerá su archivo el día que empiece a usar tablet, se crearía una SEGUNDA
 * ficha y sus pedidos quedarían partidos entre las dos — sin ningún error, sin
 * que nadie se entere hasta que cuadre mal una comisión.
 *
 * Por eso NADA se calcula aquí. El nombre aplanado, el código y el aviso de
 * "esta persona ya existe" los da el servidor (`/vendedores/vista-previa`), que
 * usa exactamente el mismo módulo que la ingesta. Copiar aquí la regla del
 * código habría sido la cuarta copia, que es justo el problema que este cambio
 * viene a quitar.
 */

interface VistaPrevia {
  nombre: string;
  codigo: string;
  existente: {
    id: string;
    nombre: string;
    codigo: string | null;
    sucursal: string | null;
    activo: boolean;
    porCodigo: boolean;
  } | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  gestores: Gestor[];
  /** Se llama tras crearlo, para que la lista se refresque. */
  onCreado: () => void;
}

export const NuevoVendedor = ({
  isOpen,
  onClose,
  gestores,
  onCreado,
}: Props) => {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [gestorId, setGestorId] = useState("");
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Se limpia al abrir, no al cerrar: si se cierra con un error a medias y se
  // vuelve a abrir, se empieza de cero en vez de heredar lo anterior.
  useEffect(() => {
    if (!isOpen) return;
    setNombre("");
    setCodigo("");
    setGestorId("");
    setPrevia(null);
  }, [isOpen]);

  // Vista previa mientras se escribe, con freno: sin él sería una petición por
  // tecla. Se cancela la anterior, así que la última en escribirse es la última
  // en pintarse aunque las respuestas lleguen desordenadas.
  useEffect(() => {
    if (!isOpen || nombre.trim().length < 3) {
      setPrevia(null);

      return;
    }

    const ac = new AbortController();
    const t = setTimeout(async () => {
      setComprobando(true);
      try {
        const q = new URLSearchParams({ nombre });

        if (codigo.trim()) q.set("codigo", codigo);
        const r = await fetch(
          `${getApiBaseUrl()}/vendedores/vista-previa?${q.toString()}`,
          { signal: ac.signal },
        );

        if (!r.ok) return;
        setPrevia(await r.json());
      } catch {
        /* cancelada o sin red: no se pinta nada, el alta sigue comprobándolo */
      } finally {
        if (!ac.signal.aborted) setComprobando(false);
      }
    }, 400);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [isOpen, nombre, codigo]);

  const guardar = useCallback(async () => {
    setGuardando(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/vendedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          codigo: codigo.trim() || undefined,
          gestorId,
        }),
      });
      const json = await r.json();

      if (!r.ok) throw new Error(json.error || "No se pudo crear el vendedor");

      addToast({
        title: "Vendedor creado",
        description: `${json.nombre} · código ${json.codigo}. Ya puedes meterle pedidos.`,
        color: "success",
      });
      onCreado();
      onClose();
    } catch (err) {
      addToast({
        title: "No se creó",
        description: err instanceof Error ? err.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setGuardando(false);
    }
  }, [nombre, codigo, gestorId, onCreado, onClose]);

  const yaExiste = !!previa?.existente;
  // Sin gestor no se puede: de él sale la sucursal. Un vendedor sin sucursal
  // nace con los pedidos ocultos, que es lo contrario de para lo que se crea.
  const puedeGuardar =
    !!nombre.trim() && !!gestorId && !yaExiste && !comprobando && !guardando;

  return (
    <Modal isOpen={isOpen} scrollBehavior="inside" size="2xl" onClose={onClose}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>Nuevo vendedor</span>
          <span className="text-sm font-normal text-default-500">
            Para los vendedores que no usan tablet. Los que sí la usan entran
            solos con su archivo: no hay que crearlos aquí.
          </span>
        </ModalHeader>

        <ModalBody className="gap-4">
          <Input
            isRequired
            description="Nombre y apellidos, como aparece en su archivo de pedidos."
            label="Nombre completo"
            placeholder="Ej: Alexander Padrón Rivera"
            value={nombre}
            variant="bordered"
            onValueChange={setNombre}
          />

          <Select
            isRequired
            description="De él sale la sucursal del vendedor y de sus pedidos."
            items={gestores}
            label="Gestor al que pertenece"
            placeholder="Elige el gestor"
            selectedKeys={gestorId ? [gestorId] : []}
            variant="bordered"
            onSelectionChange={(k) =>
              setGestorId((Array.from(k)[0] as string) ?? "")
            }
          >
            {(g) => (
              <SelectItem key={g.id} textValue={mostrarUsuario(g.username)}>
                {mostrarUsuario(g.username)}
                {g.sucursal?.nombre ? ` · ${g.sucursal.nombre}` : ""}
              </SelectItem>
            )}
          </Select>

          <Input
            description="Se genera solo con la misma regla que usan los archivos de Parranda. Cámbialo solo si sabes que el suyo es distinto."
            label="Código"
            placeholder={previa?.codigo || "nombre.apellido"}
            value={codigo}
            variant="bordered"
            onValueChange={setCodigo}
          />

          {/* Cómo va a quedar guardado. Se enseña porque el nombre se aplana
              (se le quitan tildes y se pasa a mayúsculas) y quien lo teclea
              tiene que ver el resultado, no adivinarlo. */}
          {previa && (
            <div className="p-3 rounded-lg border border-default-200 bg-default-50 text-sm flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-default-500">Se guardará como:</span>
                <span className="font-mono font-semibold">{previa.nombre}</span>
                {comprobando && <Spinner size="sm" />}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-default-500">Código:</span>
                <span className="font-mono font-semibold">{previa.codigo}</span>
              </div>
            </div>
          )}

          {/* El aviso que de verdad importa: crear otra vez a alguien que ya
              está es lo que parte sus pedidos en dos fichas. */}
          {previa?.existente && (
            <div className="p-3 rounded-lg border border-warning-200 bg-warning-50 text-warning-800 text-sm">
              <b>Ya existe.</b>{" "}
              {previa.existente.porCodigo
                ? `El código ${previa.existente.codigo} es de `
                : "Es "}
              <b>{previa.existente.nombre}</b>
              {previa.existente.sucursal
                ? ` (${previa.existente.sucursal})`
                : " (sin sucursal)"}
              {!previa.existente.activo && " — está dado de baja"}.
              <div className="mt-1">
                Si es la misma persona, búscala en la lista y enlázala a su
                gestor. No la crees otra vez: sus pedidos quedarían repartidos
                entre las dos fichas.
              </div>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            color="primary"
            isDisabled={!puedeGuardar}
            isLoading={guardando}
            onPress={guardar}
          >
            Crear vendedor
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
