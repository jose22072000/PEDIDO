/**
 * Enseñar los importes en dólares o en pesos, a elección de quien mira.
 *
 * Los precios se GUARDAN siempre en USD —es lo que da Ventra— y el CUP se calcula al
 * pintarlo. Guardar los dos sería tener dos verdades que se separan en cuanto se mueva
 * la tasa, y entonces no habría forma de saber cuál es la buena.
 *
 * La elección se recuerda en el navegador porque es preferencia de quien mira, no del
 * pedido: en la misma sucursal, quien factura quiere CUP y quien mira márgenes, USD.
 */
export type Moneda = "USD" | "CUP";

const CLAVE = "procovar.moneda";

export function monedaGuardada(): Moneda {
  try {
    return localStorage.getItem(CLAVE) === "CUP" ? "CUP" : "USD";
  } catch {
    return "USD";
  }
}

export function guardarMoneda(m: Moneda): void {
  try {
    localStorage.setItem(CLAVE, m);
  } catch {
    /* sin localStorage se pierde al recargar, y no pasa nada */
  }
}

/**
 * El importe, ya convertido y con su símbolo.
 *
 * Si piden CUP y no hay tasa, se enseña en USD en vez de un número inventado o un
 * guion: es mejor ver el importe en otra moneda que no verlo.
 */
export function importe(usd: number | null | undefined, moneda: Moneda, tasa: number | null): string {
  if (usd == null) return "—";
  if (moneda === "CUP" && tasa && tasa > 0) {
    // En pesos no se usan decimales: los precios reales van en cientos o miles y el
    // céntimo sólo ensucia la lectura.
    return `${Math.round(usd * tasa).toLocaleString("es")} CUP`;
  }
  return `$${usd.toFixed(2)}`;
}

/**
 * El mismo importe pero PELADO, para copiar y pegar.
 *
 * `importe` da texto para leer: lleva el símbolo y separador de miles. Eso está bien en
 * pantalla y mal en el portapapeles — al pegar "1.234 CUP" en una caja que espera un
 * número, o no entra o entra otra cifra. Aquí va sólo el número, con los decimales que
 * corresponden a cada moneda: dos en dólares, ninguno en pesos.
 */
export function importeCrudo(usd: number | null | undefined, moneda: Moneda, tasa: number | null): string {
  if (usd == null) return "";
  if (moneda === "CUP" && tasa && tasa > 0) return String(Math.round(usd * tasa));

  return usd.toFixed(2);
}
