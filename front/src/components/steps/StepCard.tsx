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
  // On hover: border and bg should use warningHover
  // If completed: use the warningHover bg as well

  const base = "w-full p-3 rounded-lg border transition-colors text-left";
  const defaultBorder = "border-default-200";
  const hoverClasses = "hover:border-warningHover hover:bg-warningHover/20";
  const completedClasses =
    "bg-warningHover/20 border-warningHover border-warning-200";
  const activeClasses = "ring-2 ring-warning-500 border-warning-500";

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
