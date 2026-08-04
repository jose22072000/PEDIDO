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

const CLAVE_RECARGA = "recarga-por-modulo";

/** ¿El fallo es "no pude bajar un trozo de la app" y no un error del codigo? */
function esModuloQueNoCargo(error: Error): boolean {
  const t = `${error?.name} ${error?.message}`;

  return (
    /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(t) ||
    error?.name === "ChunkLoadError"
  );
}

function yaSeIntentoRecargar(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_RECARGA) === "1";
  } catch {
    return true; // sin sessionStorage no se arriesga un bucle de recargas
  }
}

function marcarRecarga() {
  try {
    sessionStorage.setItem(CLAVE_RECARGA, "1");
  } catch {
    /* sin sessionStorage: ya se decidio no recargar */
  }
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
    if (esModuloQueNoCargo(error) && !yaSeIntentoRecargar()) {
      marcarRecarga();
      window.location.reload();

      return;
    }

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
          No se pudo mostrar {this.props.nombre ?? "esta sección"}
        </p>
        <p className="text-sm text-default-500 max-w-md">
          Hubo un fallo al pintar la pantalla. El resto del sistema sigue
          funcionando: puedes seguir trabajando en las demás secciones.
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
            onClick={() => window.location.reload()}
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
