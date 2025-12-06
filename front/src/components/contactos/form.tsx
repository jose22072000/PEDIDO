import type { Contacto } from "@/domain";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardBody,
  CardFooter,
  Input,
  Select,
  SelectItem,
  Textarea,
  Button,
} from "@heroui/react";

import { cards } from "../primitives";

import { useContactoStore, useNegocioStore } from "@/stores/entityStores";

type Props = {
  id?: string;
  onSaved?: (contactoId: string) => void;
  onCancel?: () => void;
};

const TIPOS = ["PROPIETARIO", "EMPLEADO", "OTRO"] as const;

type Tipo = (typeof TIPOS)[number];

export default function ContactosForm({ id, onSaved, onCancel }: Props) {
  const negocios = useNegocioStore((s) => s.items);
  const getById = useContactoStore((s) => s.getById);
  const create = useContactoStore((s) => s.create);
  const update = useContactoStore((s) => s.update);

  const [form, setForm] = useState<Partial<Contacto> & { tipo?: Tipo }>({
    negocioId: negocios?.[0]?.id ?? "",
    tipo: TIPOS[0],
    nombre: "",
    telefono: "",
    correo: "",
    descripcion: "",
    alias: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (id) {
      const existing = getById(id);

      if (existing) {
        setForm({ ...existing, tipo: (existing as any).tipo ?? TIPOS[0] });
      }
    }
  }, [id, getById]);

  const setField = (k: string, v: any) =>
    setForm((s) => ({ ...(s || {}), [k]: v }));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.nombre || String(form.nombre).trim().length === 0) {
      alert("El nombre es requerido");

      return;
    }
    if (!form.negocioId) {
      alert("Seleccione un negocio");

      return;
    }

    setIsSubmitting(true);
    try {
      if (id) {
        await update(id, {
          nombre: String(form.nombre),
          negocioId: String(form.negocioId),
          tipo: (form.tipo as any) ?? "OTRO",
          telefono: form.telefono || undefined,
          correo: form.correo || undefined,
          descripcion: form.descripcion || undefined,
          alias: form.alias || undefined,
        } as Partial<Contacto>);
        if (onSaved) onSaved(id);
        else alert("Contacto actualizado");
      } else {
        const newId = `contact_${Date.now()}`;
        const payload: any = {
          id: newId,
          nombre: String(form.nombre),
          negocioId: String(form.negocioId),
          tipo: (form.tipo as any) ?? "OTRO",
          telefono: form.telefono || undefined,
          correo: form.correo || undefined,
          descripcion: form.descripcion || undefined,
          alias: form.alias || undefined,
        };

        await create(payload as Contacto);
        if (onSaved) onSaved(newId);
        else alert("Contacto creado");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Error guardando contacto");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={cards({ border: true })}>
      <CardBody className="gap-4 p-0">
        <h3 className="text-lg font-bold">
          {id ? "Editar Contacto" : "Nuevo Contacto"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Negocio"
            selectedKeys={
              form.negocioId ? new Set([form.negocioId]) : new Set()
            }
            size="lg"
            variant="bordered"
            onSelectionChange={(keys: any) => {
              const first = Array.from(keys || [])?.[0];

              setField("negocioId", first ? String(first) : "");
            }}
          >
            {negocios.map((n) => (
              <SelectItem key={n.id}>{n.nombre}</SelectItem>
            ))}
          </Select>

          <Select
            label="Tipo"
            selectedKeys={form.tipo ? new Set([String(form.tipo)]) : new Set()}
            size="lg"
            variant="bordered"
            onSelectionChange={(keys: any) => {
              const first = Array.from(keys || [])?.[0];

              setField("tipo", (first as Tipo) ?? TIPOS[0]);
            }}
          >
            {TIPOS.map((t) => (
              <SelectItem key={t}>{t}</SelectItem>
            ))}
          </Select>

          <Input
            label="Nombre"
            placeholder="Nombre del contacto"
            size="lg"
            value={form.nombre || ""}
            variant="bordered"
            onValueChange={(v) => setField("nombre", v)}
          />
          <Input
            label="Alias"
            placeholder="Alias (opcional)"
            size="lg"
            value={form.alias || ""}
            variant="bordered"
            onValueChange={(v) => setField("alias", v)}
          />

          <Input
            label="Teléfono"
            placeholder="Teléfono"
            size="lg"
            value={form.telefono || ""}
            variant="bordered"
            onValueChange={(v) => setField("telefono", v)}
          />
          <Input
            label="Correo"
            placeholder="Correo electrónico"
            size="lg"
            value={form.correo || ""}
            variant="bordered"
            onValueChange={(v) => setField("correo", v)}
          />

          <div className="md:col-span-2">
            <Textarea
              label="Descripción"
              placeholder="Notas / descripción"
              value={form.descripcion || ""}
              onChange={(e: any) =>
                setField("descripcion", e?.target?.value ?? "")
              }
            />
          </div>
        </div>
      </CardBody>
      <CardFooter>
        <div className="flex gap-2 w-full">
          <Button
            className="flex-1"
            color="default"
            variant="flat"
            onPress={() => onCancel && onCancel()}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1"
            color="primary"
            isLoading={isSubmitting}
            onPress={() => handleSubmit()}
          >
            {id ? "Guardar cambios" : "Crear Contacto"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
