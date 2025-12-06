import React from "react";
import { Card } from "@heroui/react";

type Props = {
  children: React.ReactNode;
  completed?: boolean;
  active?: boolean;
  className?: string;
  onClick?: () => void;
};

export default function StepCard({
  children,
  completed,
  active,
  className = "",
  onClick,
}: Props) {
  // Default border when not active/completed: border-default-200
  // On hover: border and bg should use primaryHover
  // If completed: use the primaryHover bg as well

  const base = "w-full p-3 rounded-lg border transition-colors text-left";
  const defaultBorder = "border-default-200";
  const hoverClasses = "hover:border-primaryHover hover:bg-primaryHover/20";
  const completedClasses =
    "bg-primaryHover/20 border-primaryHover border-primary-200";
  const activeClasses = "ring-2 ring-primary-500 border-primary-500";

  const classes = [base, defaultBorder, hoverClasses, className];

  if (completed) classes.push(completedClasses);
  if (active) classes.push(activeClasses);

  return (
    <Card
      className={classes.join(" ")}
      isPressable={!!onClick}
      onPress={onClick}
    >
      {children}
    </Card>
  );
}
