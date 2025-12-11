import { Card, CardBody, Skeleton } from "@heroui/react";

interface KPICardProps {
  title: string;
  value: number | string;
  isLoading?: boolean;
  color?: "primary" | "success" | "warning" | "danger" | "default";
}

export function KPICard({
  title,
  value,
  isLoading = false,
  color = "default",
}: KPICardProps) {
  const colorClasses = {
    primary: "bg-primary-50 border-primary",
    success: "bg-success-50 border-success",
    warning: "bg-warning-50 border-warning",
    danger: "bg-danger-50 border-danger",
    default: "bg-default-50 border-default",
  };

  const textColorClasses = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    default: "text-default-700",
  };

  return (
    <Card className={`border-l-4 ${colorClasses[color]}`}>
      <CardBody className="py-4 px-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="w-3/5 rounded-lg">
              <div className="h-4 w-full rounded-lg bg-default-200" />
            </Skeleton>
            <Skeleton className="w-4/5 rounded-lg">
              <div className="h-8 w-full rounded-lg bg-default-300" />
            </Skeleton>
          </div>
        ) : (
          <>
            <p className="text-sm text-default-500 uppercase font-bold">
              {title}
            </p>
            <p className={`text-3xl font-bold mt-1 ${textColorClasses[color]}`}>
              {value}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
