import type { NavigateOptions } from "react-router-dom";

import { HeroUIProvider } from "@heroui/system";
import { ToastProvider } from "@heroui/react";
import { useHref, useNavigate } from "react-router-dom";

import { AvisoVersionNueva } from "@/components/aviso-version-nueva";

declare module "@react-types/shared" {
  interface RouterConfig {
    routerOptions: NavigateOptions;
  }
}

export function Provider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <HeroUIProvider navigate={navigate} useHref={useHref}>
      <ToastProvider placement="top-right" />
      {children}
      {/* Fuera de las rutas: sale en todas las pantallas y tambien en el login. */}
      <AvisoVersionNueva />
    </HeroUIProvider>
  );
}
