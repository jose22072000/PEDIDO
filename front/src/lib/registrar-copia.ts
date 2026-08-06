import { getApiBaseUrl } from "@/config";

/**
 * Deja constancia de que alguien copió algo al portapapeles.
 *
 * El puente con el sistema contable es MANUAL: la operadora copia
 * `P-folio; V-vendedor; C-cliente;` y lo pega en la observación de la factura de
 * AxisPos. De ese pegado depende todo lo demás — un pedido solo se puede dar por
 * facturado si su folio aparece en alguna observación. Era el único paso del
 * circuito del que no se sabía nada.
 *
 * Tres cosas a propósito:
 *
 *  - **No se espera.** La función NO devuelve promesa que nadie tenga que
 *    aguardar. Copiar tiene que sentirse instantáneo; contar es cosa nuestra, no
 *    del que está facturando.
 *  - **No avisa si falla.** El texto ya está en el portapapeles: el trabajo
 *    salió bien. Un aviso de "no se pudo registrar" solo asustaría sin que haya
 *    nada que arreglar.
 *  - **`keepalive`.** Sin esto, copiar y cerrar la pestaña acto seguido —que es
 *    exactamente lo que hace quien copia para irse a facturar— cancelaría la
 *    petición y esa copia no se contaría. Justo las que más importa contar.
 */
export function registrarCopia(datos: {
  tipo: "pedido" | "vendedor" | "cliente";
  pedidoId?: string;
  vendedorId?: string;
  clienteId?: string;
}): void {
  try {
    void fetch(`${getApiBaseUrl()}/copias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
      keepalive: true,
    }).catch(() => {
      /* sin red o servidor caído: no se cuenta esta copia y no pasa nada más */
    });
  } catch {
    /* ni siquiera se pudo lanzar la petición: copiar ya funcionó, se sigue */
  }
}
