import type { Negocio } from "@/domain/negocio";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardBody,
  CardFooter,
  Input,
  Textarea,
  Button,
  Select,
  SelectItem,
} from "@heroui/react";

import { cards } from "../primitives";

import { useNegocioStore, useTrabajadorStore } from "@/stores/entityStores";
import { useAuthStore } from "@/stores/authStore";

type Props = {
  id?: string;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
};

export const NegocioForm = ({ id, onSaved, onCancel }: Props) => {
  const getById = useNegocioStore((s) => s.getById);
  const create = useNegocioStore((s) => s.create);
  const update = useNegocioStore((s) => s.update);

  const [form, setForm] = useState<Partial<Negocio> & { asignado_id?: string }>(
    {
      nombre: "",
      direccion: "",
      alias: "",
      descripcion: "",
      asignado_id: undefined,
    },
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const auth = useAuthStore((s) => s.session);

  useEffect(() => {
    if (id) {
      const existing = getById(id);

      if (existing) setForm(existing);
    }
  }, [id, getById]);

  const setField = (k: keyof Negocio, v: any) =>
    setForm((s) => ({ ...(s || {}), [k]: v }));

  const trabajadores = useTrabajadorStore((s) => s.items);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.nombre || String(form.nombre).trim().length === 0) {
      alert("El nombre es requerido");

      return;
    }

    setIsSubmitting(true);
    try {
      if (id) {
        await update(id, {
          nombre: String(form.nombre),
          direccion: String(form.direccion || ""),
          alias: form.alias || undefined,
          descripcion: form.descripcion || undefined,
        } as Partial<Negocio>);
        if (onSaved) onSaved(id);
        else alert("Negocio actualizado");
      } else {
        const newId = `negocio_${Date.now()}`;

        await create({
          id: newId,
          nombre: String(form.nombre),
          direccion: String(form.direccion || ""),
          alias: form.alias || undefined,
          descripcion: form.descripcion || undefined,
          trabajadorAsignado: auth?.usuarioId || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as Negocio);
        if (onSaved) onSaved(newId);
        else alert("Negocio creado");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Error guardando negocio");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={cards({ border: true })}>
      <CardBody className="gap-4 p-0">
        <h3 className="text-lg font-bold">
          {id ? "Editar Negocio" : "Nuevo Negocio"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Nombre"
            placeholder="Nombre"
            size="lg"
            value={form.nombre || ""}
            variant="bordered"
            onValueChange={(v) => setField("nombre", v)}
          />
          <Input
            label="Alias"
            placeholder="Alias"
            size="lg"
            value={form.alias || ""}
            variant="bordered"
            onValueChange={(v) => setField("alias", v)}
          />

          <Input
            className="md:col-span-2"
            label="Dirección"
            placeholder="Dirección"
            size="lg"
            value={form.direccion || ""}
            variant="bordered"
            onValueChange={(v) => setField("direccion", v)}
          />

          <Select
            label="Asignado a"
            placeholder="Asignar trabajador"
            selectedKeys={
              form.asignado_id ? new Set([form.asignado_id]) : new Set()
            }
            size="lg"
            variant="bordered"
            onSelectionChange={(keys: any) => {
              const first = Array.from(keys || [])?.[0];

              setField("asignado_id" as any, first ? String(first) : undefined);
            }}
          >
            <SelectItem key="__none__">Sin asignar</SelectItem>
            {
              trabajadores.map((t) => (
                <SelectItem key={t.email}>{t.nombre}</SelectItem>
              )) as any
            }
          </Select>

          <div className="md:col-span-2">
            <Textarea
              label="Descripción"
              placeholder="Descripción"
              value={form.descripcion || ""}
              onChange={(e: any) =>
                setField("descripcion" as any, e?.target?.value ?? "")
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
            {id ? "Guardar cambios" : "Crear Negocio"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default NegocioForm;
