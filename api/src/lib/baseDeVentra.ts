import type { BaseVentra } from './ventra';

/**
 * Qué base de Ventra le corresponde a una sucursal nuestra.
 *
 * # Por qué esto vive en UN sitio
 *
 * Estaba escrito dos veces —en el sondeo del catálogo y en el cotejo de facturación— y las
 * dos copias tenían el mismo fallo. Se arregló una, el 07/09/2026, y la otra se quedó
 * rota: **Sancti Spíritus llevaba desde siempre sin catálogo**, sin precios, sin
 * existencias y sin pesos, y nadie lo vio porque no da error — la sucursal sencillamente
 * no aparecía en el bucle.
 *
 * Ésta es la clase de cosa que no puede estar duplicada: falla en silencio y sólo se nota
 * cuando alguien pregunta por un producto que no sale.
 *
 * # Los nombres no se adivinan
 *
 * Casi todas cuadran solas, por el slug (`camaguey`, `habana`) o por el nombre que Ventra
 * le da a la sucursal (`HOLGUIN`, `LAS TUNAS`). Sancti Spíritus no cuadra por ninguno:
 * nosotros la tenemos escrita **sin la C** —`SANTISPIRITUS`—, Ventra la llama
 * `SANCTI SPIRITUS` y su slug es `sspiritus`.
 *
 * Se arregla con un alias y no renombrando la sucursal: ese nombre sale en pantallas, en
 * informes y en el CSV de Parranda, y cambiarlo para arreglar un cruce interno es mover lo
 * que se ve para tapar lo que no se ve.
 */
const ALIAS: Record<string, string> = {
  SANTISPIRITUS: 'SSPIRITUS',
};

/** Sin acentos, sin espacios y en mayúsculas: es como se comparan los dos lados. */
export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * La base de Ventra de esa sucursal, o `null` si no hay ninguna que cuadre.
 *
 * `null` es un caso real y hay que tratarlo: una sucursal nuestra puede no existir todavía
 * en Ventra. Lo que no puede pasar es que se salte en silencio, que es lo que pasaba.
 */
export function baseDeSucursal(nombreSucursal: string, bases: BaseVentra[]): BaseVentra | null {
  const clave = normalizarNombre(nombreSucursal);
  const alias = ALIAS[clave];

  return (
    bases.find(
      (b) =>
        normalizarNombre(b.database) === clave ||
        normalizarNombre(b.branchName) === clave ||
        (alias != null && normalizarNombre(b.database) === alias),
    ) ?? null
  );
}
