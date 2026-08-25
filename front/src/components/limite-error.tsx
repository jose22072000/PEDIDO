import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Corta un fallo de una vista para que no se lleve por delante toda la pantalla.
 *
 * Sin esto, un error en CUALQUIER componente deja la pagina EN BLANCO: React
 * desmonta el arbol entero y no queda ni el menu. Quien lo sufre no ve un error,
 * ve una pantalla vacia — no sabe si es su internet, si esta cargando, o si el
 * sistema se cayo. El 04/08/2026 paso justo eso con la vista de vendedores y
 * costo horas averiguar que estaba roto, porque desde fuera no se distingue de
 * "va lento".
 *
 * Con esto, un fallo en una vista se queda en esa vista: se ve QUE fallo, se
 * puede reintentar sin recargar, y el resto de la aplicacion sigue usable.
 */
interface Props {
  children: ReactNode;
  /** Nombre de la vista, para que el aviso diga cual fallo. */
  nombre?: string;
}

interface Estado {
  error: Error | null;
}

/**
 * Recarga trayendo la version nueva DE VERDAD. La dispara siempre una persona con un
 * boton — aqui NO se recarga nada solo.
 *
 * Automatico se probo y salio mal dos veces: el 04/08/2026 y el 08/08/2026 la
 * aplicacion entro en bucle de recargas y no se podia trabajar. Un fallo que obliga a
 * pulsar un boton es molesto; uno que recarga la pantalla sola cada dos segundos
 * mientras alguien mete un pedido es inaceptable, y ademas no se puede arreglar en
 * caliente porque la version rota se sirve a si misma.
 *
 * Y recarga LIMPIANDO, que es lo que faltaba: un `location.reload()` a secas puede
 * devolver el MISMO index.html —del bfcache, de la memoria del navegador o de un
 * service worker que quedara instalado—, volver a pedir el fichero que ya no existe y
 * enseniar el mismo aviso. Era justo lo que pasaba: recargaban y salia lo mismo.
 */
export async function recargarLimpio(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();

      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* si no se puede, se sigue: lo que importa es recargar */
  }
  try {
    if ("caches" in window) {
      const nombres = await caches.keys();

      await Promise.all(nombres.map((n) => caches.delete(n)));
    }
  } catch {
    /* idem */
  }
  const u = new URL(window.location.href);

  u.searchParams.set("v", String(Date.now()));
  window.location.replace(u.toString());
}

/** ¿El fallo es "no pude bajar un trozo de la app" y no un error del codigo? */
function esModuloQueNoCargo(error: Error): boolean {
  const t = `${error?.name} ${error?.message}`;

  return (
    /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(t) ||
    error?.name === "ChunkLoadError"
  );
}

export class LimiteError extends Component<Props, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(error: Error): Estado {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Caso especial y MUY comun: el navegador no pudo bajar un trozo de la
    // aplicacion. Pasa despues de cada despliegue — la pestaña abierta sigue con
    // el index.html viejo, que pide ficheros con nombres antiguos que ya no
    // existen en el servidor (404). El resultado era una pantalla en blanco sin
    // ningun error a la vista y sin poder ni volver atras.
    //
    // No es un fallo del codigo: es una version vieja pidiendo cosas que ya no
    // estan. Se resuelve recargando, que trae el index.html nuevo. Se hace UNA
    // sola vez, marcandolo en sessionStorage: si recargar no lo arregla, se
    // enseña el aviso en vez de recargar sin parar.
    // Se deja en consola con la pila del componente: es lo unico que permite
    // saber DONDE fallo cuando el aviso solo dice que fallo.
    // eslint-disable-next-line no-console
    console.error(`[${this.props.nombre ?? "vista"}] falló:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
        <p className="text-lg font-semibold">
          {esModuloQueNoCargo(error)
            ? "Esta pestaña tiene una versión vieja"
            : `No se pudo mostrar ${this.props.nombre ?? "esta sección"}`}
        </p>
        {/* Decir CUÁL de los dos es cambia lo que hay que hacer. "Falta un trozo"
            se arregla con el botón de recargar y no es un fallo del sistema; un
            error de verdad no se arregla recargando y hay que avisar. Con el
            mismo texto para los dos, la gente recargaba diez veces contra un
            error que nunca se iba a arreglar así. */}
        <p className="text-sm text-default-500 max-w-md">
          {esModuloQueNoCargo(error)
            ? "Se publicó una versión nueva mientras tenías esto abierto y falta un trozo de la aplicación. Pulsa «Recargar la página»: limpia lo guardado y trae la versión nueva. No pierdes nada de lo que ya está guardado."
            : "Hubo un fallo al pintar la pantalla. El resto del sistema sigue funcionando: puedes seguir trabajando en las demás secciones."}
        </p>
        <p className="text-xs text-default-400 font-mono max-w-md break-words">
          {error.message}
        </p>
        <div className="flex gap-2 mt-2">
          <button
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
          <button
            className="px-4 py-2 rounded-lg border border-default-300 text-sm font-medium"
            onClick={() => void recargarLimpio()}
          >
            Recargar la página
          </button>
          {/* Volver atras: sin esto la pantalla rota atrapa a quien la ve, que
              es lo que mas molesta — ni ver el error ni poder salir. */}
          <button
            className="px-4 py-2 rounded-lg border border-default-300 text-sm font-medium"
            onClick={() => window.history.back()}
          >
            Volver atrás
          </button>
        </div>
      </div>
    );
  }
}
