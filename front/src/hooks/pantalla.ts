import { useEffect, useState } from "react";

/**
 * El corte entre «cabe al lado» y «no cabe»: el `lg` de Tailwind, 1024 px.
 *
 * Es el mismo que usa el detalle del pedido para poner la factura al lado en vez de
 * debajo. Teniendo un solo número, la ventana no puede quedarse a medias —el modal
 * creyendo que hay sitio y el contenido creyendo que no—, que es como salen esas
 * pantallas con media tarjeta cortada.
 */
export const CORTE_ANCHO = 1024;

/**
 * Si la pantalla es de móvil o tablet.
 *
 * En pantalla pequeña un modal se come el sitio, deja el contenido apretado y el gesto
 * de cerrar no cae donde la mano espera. Por debajo de este corte, las mismas pantallas
 * se abren como cajón: entra desde el borde, ocupa lo que necesita y se cierra
 * arrastrando. Por encima se queda el modal, que en escritorio va mejor.
 *
 * Arranca en `false` a propósito. En el primer pintado todavía no se sabe el ancho, y
 * suponer «pequeña» hace que en escritorio se vea un cajón durante un instante antes de
 * convertirse en modal. Al revés no se nota: el cajón aparece ya bien.
 */
export function usePantallaChica(): boolean {
  const [chica, setChica] = useState(false);

  useEffect(() => {
    // `matchMedia` y no un `resize`: el navegador avisa sólo cuando se CRUZA el corte,
    // en vez de en cada píxel que se arrastra la ventana.
    const consulta = window.matchMedia(`(max-width: ${CORTE_ANCHO - 1}px)`);

    setChica(consulta.matches);

    const alCambiar = (e: MediaQueryListEvent) => setChica(e.matches);

    consulta.addEventListener("change", alCambiar);

    return () => consulta.removeEventListener("change", alCambiar);
  }, []);

  return chica;
}
