"use client";

import React from "react";
import { Avatar, Button, Link } from "@heroui/react";

import Icons from "@/components/icons/iconify";

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
      <div className="w-full flex justify-center md:w-fit md:min-w-fit">
        <Button
          as={Link}
          className="btn w-full max-w-[300px] min-w-[300px] text-center"
          color="primary"
          href={cta.href}
          size="lg"
          startContent={<Icons.back className="size-12! md:size-16!" />}
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
