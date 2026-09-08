import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import { recargarLimpio } from "@/components/limite-error";
import { vigilarVersion } from "@/lib/version-nueva";

/** Cuanto se calla el aviso cuando alguien pulsa «Ahora no». */
const POSPUESTO = 30 * 60_000;

/**
 * «Hay una version nueva — recarga».
 *
 * Va montado en el Provider, fuera de las rutas, para que salga en TODAS las pantallas
 * y tambien en el login. Un aviso que solo aparece en algunas vistas es un aviso que no
 * ve quien lleva tres horas en la de pedidos, que es precisamente quien lo necesita.
 *
 * Lo que NO hace: quitarse para siempre. «Ahora no» lo calla media hora y vuelve. Una ✕
 * definitiva convierte esto en algo que se cierra sin leer el primer dia y ya nunca
 * avisa de nada — y el fallo que venia a evitar (trabajar con codigo viejo sin saberlo)
 * volveria igual, pero ahora con la excusa de que «el aviso ya se dio».
 */
export function AvisoVersionNueva() {
  const [hayNueva, setHayNueva] = useState(false);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => vigilarVersion(() => setHayNueva(true)), []);

  if (!hayNueva) return null;

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-warning-200 bg-warning-50 p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 dark:border-warning-500/30 dark:bg-warning-500/10"
      role="status"
    >
      <p className="text-sm font-semibold text-warning-700 dark:text-warning-400">
        Hay una versión nueva de PROCOVAR
      </p>
      {/* Decir que no se pierde nada es la mitad del aviso: sin eso, quien tiene un
          pedido a medio escribir no pulsa el boton — y con razon. */}
      <p className="mt-1 text-xs text-default-600">
        Esta pestaña está usando una versión anterior. Recarga para tener los
        últimos cambios; lo que ya está guardado no se pierde.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          color="warning"
          isLoading={recargando}
          size="sm"
          onPress={() => {
            setRecargando(true);
            void recargarLimpio();
          }}
        >
          Recargar ahora
        </Button>
        <Button
          size="sm"
          variant="light"
          onPress={() => {
            setHayNueva(false);
            // Vuelve sola: el aviso no se puede quitar del todo, solo aplazar.
            setTimeout(() => setHayNueva(true), POSPUESTO);
          }}
        >
          Ahora no
        </Button>
      </div>
    </div>
  );
}
