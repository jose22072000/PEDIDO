/**
 * El desglose del domicilio por grupo de productos, y que cuadre con el total.
 *
 * Vive aparte de `domicilio.ts` porque ahí dentro todo toca la base de datos y esto no
 * toca nada: son las reglas de dinero, puras, y así se pueden probar sin levantar Prisma.
 * No es una separación de adorno — es lo único de la integración que decide un importe a
 * partir de lo que manda un tercero.
 */
/**
 * Una línea del desglose: lo que cuesta el domicilio de ESE grupo de productos.
 *
 * `pedidoId` es opcional y es el que decide cómo se escribe todo lo demás. En la APK, un
 * domicilio puede cubrir DOS pedidos distintos que van en el mismo viaje —visto el
 * 15/09/2026: CES en `Ped56434` y PROCOVAR en `Ped67545`, mismo cliente, mismo vendedor—
 * y entonces cada grupo lleva el suyo. Si no viene, el domicilio entero es de un solo
 * pedido, el de la entrada.
 */
export type GrupoEntrega = {
  grupo: string;
  entrega: number;
  /** Lo que valen los productos de ese grupo. `null` = no lo mandaron. */
  productos?: number | null;
  pedidoId?: string | null;
  folio?: string | null;
};

/**
 * Deja los grupos en limpio, o dice que no valen.
 *
 * Devuelve `null` cuando no vino ninguno —que es lo normal en el formato viejo— y
 * `'invalido'` cuando vinieron pero mal. Son dos cosas distintas: lo primero se ignora,
 * lo segundo se rechaza. Si se confundieran, un desglose mal formado se guardaría como
 * "sin desglose" y la factura de un grupo saldría sin su domicilio sin que nadie lo vea.
 *
 * Los nombres se recortan pero NO se normalizan (ni minúsculas, ni tildes fuera): el
 * grupo es de ellos y lo que guardemos tiene que poder compararse con lo suyo tal cual.
 * Dos grupos con el mismo nombre en la misma entrega sí es un error: la clave de la
 * tabla es (pedido, grupo) y uno pisaría al otro en silencio.
 */
export function normalizarGrupos(crudos: unknown): GrupoEntrega[] | null | 'invalido' {
  if (crudos == null) return null;
  if (!Array.isArray(crudos)) return 'invalido';
  if (crudos.length === 0) return null;

  const limpios: GrupoEntrega[] = [];
  const vistos = new Set<string>();

  for (const g of crudos) {
    if (!g || typeof g !== 'object') return 'invalido';
    const nombre = String((g as any).grupo ?? (g as any).nombre ?? '').trim();
    const entrega = Number((g as any).entrega ?? (g as any).costo ?? (g as any).domicilio);
    if (!nombre || nombre.length > 120) return 'invalido';
    if (!Number.isFinite(entrega) || entrega < 0) return 'invalido';
    if (vistos.has(nombre)) return 'invalido';
    vistos.add(nombre);
    // El pedido de ESE grupo, si lo trae. Se guarda tal cual: es nuestro id y no se toca.
    const suyo = (g as any).pedidoId ?? (g as any).id ?? null;
    const suFolio = (g as any).folio ?? (g as any).numeroPedido ?? null;
    /**
     * El valor de los productos del grupo. Opcional y NO entra en el cuadre del total:
     * `total` es sólo la suma de las entregas. Si viniera mal, se rechaza igual — un
     * importe negativo no es un dato dudoso, es un dato falso.
     */
    const prod = (g as any).productos ?? (g as any).subtotalProductos ?? (g as any).totalProductos;
    const productos = prod == null || prod === '' ? null : Number(prod);
    if (productos != null && (!Number.isFinite(productos) || productos < 0)) return 'invalido';

    limpios.push({
      grupo: nombre,
      entrega: Number(entrega.toFixed(2)),
      productos: productos == null ? null : Number(productos.toFixed(2)),
      pedidoId: suyo == null || suyo === '' ? null : String(suyo),
      folio: suFolio == null || suFolio === '' ? null : String(suFolio),
    });
  }

  return limpios;
}

/**
 * Cuánto se cobra de domicilio, y si el desglose cuadra con ello.
 *
 * Aparte y sin base de datos porque es lo único aquí que decide DINERO a partir de lo que
 * manda un tercero, y se puede equivocar en silencio: un total que no cuadra con sus
 * grupos no rompe nada, sólo hace que una factura salga con un domicilio que no es.
 *
 * Las reglas:
 *
 *   - Sin total pero con grupos, el total es la suma. Es la definición, no una suposición.
 *   - Con los dos y sin cuadrar, se RECHAZA en vez de elegir uno. Elegir sería inventar:
 *     o se cobra un total que no se corresponde con lo que se factura por grupo, o se
 *     publica un desglose que no suma lo cobrado. Rechazando, el motivo queda escrito en
 *     EntregaIntento y se ve desde el panel.
 *   - El margen es de un céntimo: las dos partes redondean a dos decimales por su cuenta,
 *     y un céntimo de diferencia es aritmética, no el error de nadie.
 *   - Un total que falta NO es un cero. Un domicilio en cero parece un domicilio gratis y
 *     nadie lo mira; un rechazo se ve.
 */
// Un objeto plano y no un union discriminado: este proyecto compila sin
// strictNullChecks y ahí el union no estrecha. Mismo motivo que en `routes/webhooks.ts`.
export type TotalDomicilio = {
  /** El importe a cobrar, o null si no se pudo resolver. */
  costo: number | null;
  /** El desglose limpio, null cuando no vino ninguno (formato viejo). */
  grupos: GrupoEntrega[] | null;
  /** Por qué no vale. null = vale. */
  motivo: string | null;
};

export function resolverTotalDomicilio(
  declaradoCrudo: unknown,
  gruposCrudos: unknown,
): TotalDomicilio {
  const grupos = normalizarGrupos(gruposCrudos);
  if (grupos === 'invalido') {
    return { costo: null, grupos: null, motivo: 'grupos: cada uno necesita un nombre distinto y una entrega >= 0' };
  }

  const suma = grupos ? Number(grupos.reduce((s, g) => s + g.entrega, 0).toFixed(2)) : null;
  const declarado = declaradoCrudo == null || declaradoCrudo === '' ? NaN : Number(declaradoCrudo);
  const costo = Number.isFinite(declarado) ? declarado : (suma ?? NaN);

  if (!Number.isFinite(costo) || costo < 0) {
    return { costo: null, grupos: null, motivo: 'costo no es un número válido' };
  }
  /**
   * El margen se compara en CÉNTIMOS ENTEROS, no con `Math.abs(a - b) > 0.01`.
   *
   * Esa resta en coma flotante da 0.010000000000005 para 65.01 contra 65.00, que es
   * mayor que 0.01: el céntimo de redondeo que esto venía a perdonar quedaba rechazado
   * siempre. Y un rechazo aquí no es un error visible — es una entrega que se reintenta
   * cada 60 s durante 24 h y acaba marcada Fallida. Lo cazó la prueba, no el despliegue.
   */
  const centimos = (v: number) => Math.round(v * 100);
  if (suma != null && Number.isFinite(declarado) && Math.abs(centimos(suma) - centimos(declarado)) > 1) {
    return {
      costo: null,
      grupos: null,
      motivo: `el total (${declarado.toFixed(2)}) no cuadra con la suma de los grupos (${suma.toFixed(2)})`,
    };
  }

  return { costo, grupos, motivo: null };
}

/**
 * ¿El domicilio es de UN pedido, o hay que repartirlo entre varios?
 *
 * Un domicilio de la APK puede cubrir dos pedidos que van en el mismo viaje, y entonces
 * cada grupo trae el suyo con SU parte de la tarifa. Mandarlo todo al pedido de la
 * cabecera dejaría al otro sin domicilio y a éste cobrando de más: visto el 15/09/2026,
 * `Ped56434` (CES, $0.40) y `Ped67545` (PROCOVAR, $0.07) en la misma pantalla.
 *
 * `mezclado` —unos grupos con pedido y otros sin él— NO se adivina. Sin saber a cuál va
 * la parte huérfana, cualquier reparto es inventado, y lo que se inventa es dinero. Se
 * rechaza y queda el motivo escrito.
 */
export function repartoDeGrupos(grupos: GrupoEntrega[] | null): 'entero' | 'porGrupo' | 'mezclado' {
  if (!grupos || grupos.length === 0) return 'entero';

  const conPedido = grupos.filter((g) => g.pedidoId || g.folio).length;
  if (conPedido === 0) return 'entero';
  if (conPedido === grupos.length) return 'porGrupo';
  return 'mezclado';
}
