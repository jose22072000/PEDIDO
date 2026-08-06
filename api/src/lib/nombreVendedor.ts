/**
 * La identidad de un vendedor: cómo se aplana su nombre y cómo se forma su código.
 *
 * Esto vive aparte porque lo usan DOS caminos que tienen que coincidir al
 * carácter: la ingesta del CSV (que crea vendedores sola, sin que nadie mire) y
 * el alta manual desde la aplicación. Si los dos aplanaran distinto, un vendedor
 * dado de alta a mano no sería reconocido cuando empezara a llegar su CSV: se
 * crearía una SEGUNDA ficha y sus pedidos quedarían partidos entre las dos, la
 * mitad en cada una. Nadie ve eso hasta que cuadra mal una comisión.
 *
 * Antes la regla del código estaba copiada en tres sitios (`orderRecord.dto.ts`,
 * `orders.ts` y `recompute-vendedor-codigos.mjs`) con un comentario avisando de
 * que había que cambiarlos todos a la vez. Ese aviso es exactamente la señal de
 * que sobraba un módulo: ahora hay UNA implementación y no puede haber deriva.
 */

/**
 * Quita todo lo que hace que dos textos idénticos a la vista sean cadenas
 * distintas.
 *
 *  - Las TILDES. Una tilde se puede escribir como un carácter propio o como
 *    letra + tilde aparte. Se pintan IGUAL. El 06/08/2026 esto tumbó la ingesta
 *    de Camagüey durante dos días: el import rechazaba los archivos con "el
 *    código 'georlis.cardenas' ya pertenece a GEORLIS MICHEL CARDENAS MORA, pero
 *    el archivo trae GEORLIS MICHEL CARDENAS MORA" — los dos nombres iguales en
 *    pantalla. Un mensaje con las dos partes idénticas es la firma de esto.
 *  - Los caracteres de CONTROL e invisibles. Un CSV que pasó por un encoding
 *    roto arrastra bytes que no se ven pegados al nombre ("PADRÃN" trae un
 *    U+0093 detrás).
 */
function aplanar(s: string): string {
  return (s || '')
    .normalize('NFD') // separa la letra de su tilde
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // y tira la tilde
    .replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\ufeff]', 'g'), ''); // y lo invisible
}

/**
 * El nombre tal y como se GUARDA y como se COMPARA. Las dos cosas con la misma
 * vara, que es la única forma de que no puedan discrepar.
 *
 * Se compara en mayúsculas porque el mismo vendedor llega escrito de las dos
 * formas según qué equipo exportó el archivo.
 */
export function nombreComparable(s: string): string {
  return aplanar(s).toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * El código tal y como se BUSCA en la base.
 *
 * NO se pasa a mayúsculas a propósito: los códigos están guardados en minúscula
 * y uppercasearlos dejaría de encontrarlos a todos. Sí se le quitan las tildes,
 * porque había 4 en la base ('tomás.manzanares', 'evelyn.charité',
 * 'elena.bolívar', 'danisley.gámez') que NUNCA podían casar con lo que traía el
 * archivo — esos cuatro vendedores llevaban desde junio sin recibir un pedido.
 */
export function codigoComparable(s: string): string {
  return aplanar(s).trim();
}

/**
 * El código a partir del nombre: `nombre.primer_apellido`.
 *
 * Los nombres cubanos son: nombre [segundo nombre] apellido1 [apellido2]. Coger
 * las 2 primeras palabras agarraría el SEGUNDO NOMBRE, no el apellido:
 *
 *   "GLENDA MELISA BLANCO ÁLVAREZ" -> glenda.melisa   ✗  (y colisiona fácil)
 *
 * El primer apellido es la PENÚLTIMA palabra cuando hay dos apellidos, y la
 * última cuando solo hay uno:
 *
 *   "GLENDA MELISA BLANCO ÁLVAREZ" -> glenda.blanco    ✓
 *   "DIANGO DAVID GOLA BLANCO"     -> diango.gola      ✓
 *   "ALEXANDER PADRON"             -> alexander.padron ✓
 *
 * Esto no es una preferencia de estilo: reproduce el nombre con el que Parranda
 * exporta los archivos al Drive ("alexander.padron.pedidos.csv"), y ese nombre
 * no lo podemos cambiar nosotros. Por eso el alta manual usa la MISMA regla: si
 * ese vendedor empieza mañana a usar tablet, su archivo cae sobre la ficha que
 * ya existe en vez de crear otra.
 */
export function codigoDesdeNombre(nombre: string): string {
  const partes = aplanar(nombre).trim().split(/\s+/).filter(Boolean);

  if (partes.length >= 3) return `${partes[0]}.${partes[partes.length - 2]}`.toLowerCase();
  if (partes.length === 2) return `${partes[0]}.${partes[1]}`.toLowerCase();

  return aplanar(nombre).trim().toLowerCase();
}

/** Un código válido: minúsculas, números, punto, guion y guion bajo. */
const CODIGO_VALIDO = /^[a-z0-9._-]+$/;

/**
 * Normaliza un código TECLEADO a mano y dice si sirve.
 *
 * A diferencia del que llega por CSV —que lo genera `codigoDesdeNombre` y ya
 * viene limpio— este lo escribe una persona, así que además se pasa a minúscula
 * (la convención de todos los que hay) y se le quitan los espacios: un código
 * con un espacio al final no se ve y no casaría jamás con el del archivo.
 */
export function normalizarCodigoManual(valor: unknown): { codigo: string; error?: string } {
  if (typeof valor !== 'string') return { codigo: '', error: 'El código es obligatorio.' };

  const codigo = codigoComparable(valor).toLowerCase().replace(/\s+/g, '');

  if (!codigo) return { codigo: '', error: 'El código es obligatorio.' };
  if (!CODIGO_VALIDO.test(codigo)) {
    return {
      codigo,
      error: 'El código solo admite letras sin tilde, números, punto, guion y guion bajo.',
    };
  }

  return { codigo };
}
