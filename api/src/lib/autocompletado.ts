export { FACTURADO, POR_LA_FACTURA, camposParaCompletar, conservaSuFactura } from './reglaFactura';

/**
 * Lo que quedó aquí son las reglas de la factura, que se re-exportan para no obligar a
 * media docena de ficheros a cambiar de import.
 *
 * Aquí vivía también `avisarCompletadoAutomatico`, el aviso a Parranda de un pedido que
 * se completaba solo. Se quitó con el webhook el 26/09/2026: nunca estuvo configurado.
 */
