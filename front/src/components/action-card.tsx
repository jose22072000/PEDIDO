import type { CardProps } from "@heroui/react";

import React from "react";
import { Card, CardBody, Link } from "@heroui/react";
// Icons are passed as React SVG components (no runtime icon library required)
import { cn } from "@heroui/react";

import Icons from "@/components/icons/iconify";

export type ActionCardProps = CardProps & {
  icon: keyof typeof Icons | string;
  title: string;
  color?: "primary" | "secondary" | "primary" | "danger";
  description?: string;
  href?: string;
};

const ActionCard = React.forwardRef<HTMLDivElement, ActionCardProps>(
  (
    { color, title, icon, description, children, className, href, ...props },
    ref,
  ) => {
    const colors = React.useMemo(() => {
      switch (color) {
        case "primary":
          return {
            card: "border-default-200",
            iconWrapper: "bg-primary-50 border-primary-100",
            icon: "text-primary",
          };
        case "secondary":
          return {
            card: "border-secondary-100",
            iconWrapper: "bg-secondary-50 border-secondary-100",
            icon: "text-secondary",
          };
        case "primary":
          return {
            card: "border-white/20 bg-primary-50/25 hover:bg-primary-50/80 transition card-primary",
            iconWrapper:
              "card-primary__icon-wrapper bg-primary-50 border-primary-100",
            icon: "card-primary__icon text-primary-600",
          };
        case "danger":
          return {
            card: "border-danger-300",
            iconWrapper: "bg-danger-50 border-danger-100",
            icon: "text-danger",
          };

        default:
          return {
            card: "border-default-200",
            iconWrapper: "bg-default-50 border-default-100",
            icon: "text-default-500",
          };
      }
    }, [color]);

    const content = (
      <Card
        ref={ref}
        isPressable
        className={cn("border-2 h-full w-full", colors?.card, className)}
        shadow="sm"
        {...props}
      >
        <CardBody className="flex h-full flex-row items-start gap-3 p-4">
          <div
            className={cn(
              "item-center rounded-medium flex border p-2",
              colors?.iconWrapper,
            )}
          >
            {icon
              ? (() => {
                const IconComp = (Icons as any)[icon as string] as
                  | React.ElementType
                  | undefined;

                if (IconComp)
                  return React.createElement(IconComp, {
                    className: colors?.icon,
                    width: 40,
                    height: 40,
                  });

                return null;
              })()
              : null}
          </div>
          <div className="flex flex-col">
            <p className="subheading !font-bold text-primary">{title}</p>
            <p className="paragraph text-primary !font-semibold">
              {description || children}
            </p>
          </div>
        </CardBody>
      </Card>
    );

    if (href) {
      return (
        <Link className="block" href={href}>
          {content}
        </Link>
      );
    }

    return content;
  },
);

ActionCard.displayName = "ActionCard";

export default ActionCard;
