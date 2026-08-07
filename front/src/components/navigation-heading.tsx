"use client";

import React from "react";
import { Avatar, Button, Link } from "@heroui/react";

import Icons from "@/components/icons/iconify";
import { SucursalSelector } from "@/components/sucursal-selector";
import { UserMenu } from "@/components/user-menu";

export const NavigationHeading = ({
  title,
  paragraph,
  cta,
  icon = "panel",
}: {
  title: React.ReactNode;
  paragraph: React.ReactNode;
  cta: { href: string; label: React.ReactNode };
  icon?: keyof typeof Icons | string;
}) => {
  const CardIconComp: React.ComponentType<any> =
    (Icons as any)[icon] ?? (Icons as any)["maximize"] ?? (() => null);

  return (
    <div className="flex flex-col-reverse md:flex-row gap-8 mb-8">
      <div className="w-full">
        <div className="flex items-center gap-4 mb-2">
          <div className="min-w-14 md:min-w-16">
            <Avatar
              isBordered
              className="size-14 md:size-16 p-3"
              color="primary"
              icon={<CardIconComp className="size-12" />}
              radius="md"
              size="md"
            />
          </div>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-pretty text-primary">
              {title}
            </h2>
            <p className="hidden md:block text-lg font-semibold text-primary">
              {paragraph}
            </p>
          </div>
        </div>
        <p className="block md:hidden text-lg text-default-500">{paragraph}</p>
      </div>
      {/*
        Los tres controles de la esquina comparten fila, altura y radio.
        Antes cada uno traía la suya: el selector `sm` (32 px), el menú de
        usuario por defecto (40 px) y el botón `lg` con el icono forzado a
        `size-16` — una flecha más alta que el propio botón. Tres alturas
        distintas pegadas, y el botón centrado debajo sin alinear con nada.

        `items-end` los apoya en la MISMA línea de base que el título de la
        izquierda, que es lo que hace que la cabecera se lea como una sola pieza
        y no como tres cosas apiladas.
      */}
      <div className="w-full flex flex-col items-stretch gap-2 md:w-auto md:flex-row md:flex-wrap md:items-end md:justify-end">
        <SucursalSelector />
        <UserMenu />
        <Button
          as={Link}
          color="primary"
          href={cta.href}
          radius="md"
          size="md"
          startContent={<Icons.back className="size-5" />}
          variant="shadow"
        >
          {cta.label}
        </Button>
      </div>
    </div>
  );
};

/*

 */
