/**
 * Saber si el servidor ya sirve una version distinta de la que corre esta pestaña.
 *
 * EL PROBLEMA. Una pestaña abierta sigue ejecutando el JavaScript que bajo el dia que
 * se abrio, pase lo que pase despues. Las operadoras y las facturadoras dejan PEDIDO
 * abierto toda la semana, y un dia con diez despliegues significa que estan usando
 * codigo de hace diez versiones. Lo que se ve entonces no parece "version vieja": el
 * 08/09/2026 la facturadora de La Habana leyo «Tu rol no puede completar pedidos» —un
 * permiso que ya estaba arreglado en el servidor— y se perdio media mañana buscando un
 * fallo de permisos que no existia.
 *
 * QUE NO SIRVE PARA MEDIRLO. El `/salud` de la API dice que version corre la API. Eso
 * es OTRO contenedor, que se despliega por su cuenta: puede estar recien actualizado
 * con el front viejo, o al reves. Lo que hay que comparar es el JavaScript que esta
 * corriendo aqui contra el que sirve nginx AHORA.
 *
 * COMO SE MIDE. Cada build de Vite escribe en index.html los ficheros de /assets/ con
 * el hash del contenido en el nombre. Esa lista cambia si y solo si cambio el codigo:
 * es la huella exacta de una version, sin numero que nadie tenga que acordarse de
 * subir. index.html se sirve con `no-store` (comprobado en el nginx del contenedor el
 * 08/09/2026), asi que pedirlo devuelve siempre el de ahora — 2 kB.
 *
 * La huella local se saca del MISMO sitio y con el MISMO extractor: el HTML que trajo
 * esta pestaña. Se lee al cargar el modulo, antes de que React toque nada.
 */

/** Los ficheros de /assets/ que nombra un HTML, en orden y sin repetir. */
function huella(html: string): string {
  const nombres = html.match(/\/assets\/[A-Za-z0-9._-]+/g);

  if (!nombres) return "";

  return Array.from(new Set(nombres)).sort().join("|");
}

/**
 * La version que corre ESTA pestaña. Se congela al cargar el modulo: mas adelante
 * React ya habra reescrito el documento y el HTML original no se podria recuperar.
 *
 * En desarrollo sale vacia —Vite sirve /src/main.tsx, no hay /assets/— y eso apaga
 * todo el vigilante. Es lo que se quiere: en desarrollo el servidor cambia cada vez
 * que se guarda un fichero y el aviso saldria sin parar.
 */
const HUELLA_LOCAL =
  typeof document === "undefined"
    ? ""
    : huella(document.documentElement.outerHTML);

/** Cada cuanto se pregunta, con la pestaña a la vista. */
const CADA = 5 * 60_000;
/** Cuanto se espera antes de la primera pregunta: acabamos de cargar, no hay prisa. */
const PRIMERA = 60_000;

/**
 * Marca de la version por la que YA se recargo sola esta pestaña.
 *
 * Es el freno que hace imposible el bucle. Recargar solo salio mal dos veces en este
 * proyecto —04/08/2026 y 08/08/2026, la aplicacion parpadeando cada dos segundos en
 * Sancti Spiritus— y las dos por lo mismo: una recarga que no arregla la causa se
 * repite para siempre. Si al volver seguimos viendo la misma version nueva por bajar
 * (un proxy que sirve un index.html a la navegacion y otro al fetch, por ejemplo), NO
 * se recarga otra vez: se enseña el aviso y decide una persona.
 *
 * En sessionStorage a proposito: vale para esta pestaña y muere con ella.
 */
const CLAVE_YA_RECARGADA = "procovar:version-recargada";

function yaSeRecargoPor(marca: string): boolean {
  try {
    return sessionStorage.getItem(CLAVE_YA_RECARGADA) === marca;
  } catch {
    // Navegador sin almacenamiento (modo privado estricto): sin freno no se
    // recarga sola NUNCA. Mejor un aviso de mas que un bucle.
    return true;
  }
}

function anotarRecarga(marca: string): void {
  try {
    sessionStorage.setItem(CLAVE_YA_RECARGADA, marca);
  } catch {
    /* si no se puede anotar, el `yaSeRecargoPor` de arriba ya dice que no se recargue */
  }
}

/** La version que sirve el servidor ahora mismo, o null si no se pudo preguntar. */
async function huellaDelServidor(): Promise<string | null> {
  try {
    const r = await fetch(`/index.html?v=${Date.now()}`, {
      cache: "no-store",
      // Sin credenciales ni cabeceras: es un fichero estatico. El envoltorio de
      // `fetch` de main.tsx le pondra el token igual y no molesta.
      headers: { Accept: "text/html" },
    });

    if (!r.ok) return null;

    const texto = await r.text();
    const h = huella(texto);

    // Un HTML sin /assets/ no es el index del build: es una pagina de error del
    // proxy, un portal cautivo o un 200 con cualquier cosa. Tratarlo como version
    // distinta avisaria de una version nueva que no existe.
    return h || null;
  } catch {
    // Sin red, o el fetch corto por el tope de 25 s. No es noticia: se reintenta.
    return null;
  }
}

/**
 * Empieza a vigilar. Devuelve la funcion para dejar de hacerlo.
 *
 * `alHaberVersionNueva` se llama UNA vez, cuando se detecta. A partir de ahi el
 * vigilante se apaga solo: ya no hay nada mas que descubrir, y seguir preguntando cada
 * cinco minutos con el aviso puesto solo gasta red.
 */
export function vigilarVersion(
  alHaberVersionNueva: (marca: string) => void,
): () => void {
  if (!HUELLA_LOCAL) return () => {};

  let vivo = true;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  let mirando = false;

  const parar = () => {
    vivo = false;
    if (reloj) clearTimeout(reloj);
    document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    window.removeEventListener("online", mirar);
  };

  async function mirar() {
    if (!vivo || mirando) return;
    mirando = true;
    try {
      const remota = await huellaDelServidor();

      if (!vivo || !remota || remota === HUELLA_LOCAL) return;

      // Hay version nueva.
      //
      // Con la pestaña OCULTA se recarga sola: no hay nadie escribiendo, no se
      // interrumpe nada y quien vuelva se encuentra la version buena sin tener que
      // hacer nada. Es justo el caso de la facturadora, que la deja abierta de un
      // dia para otro.
      //
      // Con la pestaña A LA VISTA no se recarga NUNCA sola. Puede haber un pedido a
      // medio escribir, y perderlo es peor que la version vieja. Ahi manda el aviso,
      // que tiene su boton.
      if (document.visibilityState === "hidden" && !yaSeRecargoPor(remota)) {
        anotarRecarga(remota);
        parar();
        const { recargarLimpio } = await import("@/components/limite-error");

        void recargarLimpio();

        return;
      }

      parar();
      alHaberVersionNueva(remota);
    } finally {
      mirando = false;
      if (vivo) reloj = setTimeout(mirar, CADA);
    }
  }

  function alCambiarVisibilidad() {
    // Se mira en los DOS sentidos, y por razones distintas. Al volver a la pestaña,
    // porque es el momento exacto en que se va a usar y en el que un aviso sirve de
    // algo. Al dejarla, porque es cuando se puede recargar sin molestar a nadie.
    void mirar();
  }

  reloj = setTimeout(mirar, PRIMERA);
  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  // Volver de un corte de red es otro momento bueno: en las sucursales se cae el
  // enlace a ratos, y los despliegues suelen coincidir con el rato sin red.
  window.addEventListener("online", mirar);

  return parar;
}
