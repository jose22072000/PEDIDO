import prisma from '../prismaClient';

/**
 * Deja apuntado qué intenta meter la APK de Entrega y cómo acaba.
 *
 * # Por qué existe
 *
 * Hasta hoy esto sólo estaba en el log del contenedor, que es un sitio donde Jose no puede
 * mirar: para saber por qué una entrega no salía de «pendientes» había que entrar al
 * servidor. Y el log se va: `docker service logs` guarda lo que guarda, así que a los dos
 * días el rastro de por qué se atascó algo ya no está.
 *
 * Guardándolo, la pantalla de Sincronización responde sola las tres preguntas que se
 * repiten: qué folios están fallando, desde cuándo, y si el pedido existe o todavía no se
 * ha subido.
 *
 * # Nunca puede tumbar el webhook
 *
 * Es un registro, no parte del trabajo. Si escribir falla —la tabla no está, la base va
 * lenta—, la entrega tiene que aplicarse igual: lo que importa es que el costo entre. Por
 * eso todo va dentro de un `catch` que se traga el error y sigue.
 */
/**
 * De qué TIPO es lo que pasó, a partir del motivo.
 *
 * El texto del motivo está escrito para que Amado sepa qué hacer, así que se reescribe
 * cuando hace falta explicarlo mejor. El código es lo que no se toca: es lo que agrupa las
 * filas y lo que la pantalla usa para clasificar y contar.
 */
export function codigoDelMotivo(motivo: string | null, ok: boolean): string {
  if (ok) return 'ok';

  const m = (motivo || '').toLowerCase();

  if (m.includes('folio no encontrado')) return 'no_subido';
  if (m.includes('no va a domicilio')) return 'sin_domicilio';
  if (m.includes('clientes distintos') || m.includes('folio repetido')) return 'ambiguo';
  if (m.includes('costo no es un')) return 'costo_invalido';
  if (m.includes('falta pedidoid')) return 'sin_identificar';
  if (m.includes('otra sucursal')) return 'otra_sucursal';

  return 'otro';
}

export type IntentoDeEntrega = {
  folio: string | null;
  motivo: string | null;
  ok: boolean;
  pedidoId?: string | null;
  cliente?: string | null;
  /** Con qué identificaron al vendedor, o que no lo mandaron. */
  vendedor?: string | null;
  /** Los nombres de los campos que venían, para saber qué manda de verdad la APK. */
  campos?: string | null;
  costo?: number | null;
};

export async function apuntarIntentos(entradas: IntentoDeEntrega[]): Promise<void> {
  for (const e of entradas) {
    // Sin folio no hay nada que agrupar: son las entradas que ni siquiera dicen a qué
    // pedido van, y se apuntan bajo una etiqueta común para que se vean sin ensuciar.
    const folio = (e.folio || '').trim() || '(sin folio)';
    const motivo = e.ok ? '' : (e.motivo || 'no aplicada').trim();
    const codigo = codigoDelMotivo(motivo, e.ok);

    try {
      await prisma.entregaIntento.upsert({
        where: { folio_codigo: { folio, codigo } },
        create: {
          folio, codigo, motivo, ok: e.ok,
          pedidoId: e.pedidoId ?? null,
          cliente: e.cliente ?? null,
          vendedor: e.vendedor ?? null,
          campos: e.campos ?? null,
          costo: e.costo ?? null,
        },
        update: {
          intentos: { increment: 1 },
          ultimoAt: new Date(),
          // El texto del último intento: si se reescribe el mensaje, se ve el de ahora.
          motivo,
          ok: e.ok,
          // El pedido resuelto y el cliente se refrescan: si antes no se sabía cuál era y
          // ahora sí, interesa lo de ahora.
          ...(e.pedidoId ? { pedidoId: e.pedidoId } : {}),
          ...(e.cliente ? { cliente: e.cliente } : {}),
          ...(e.vendedor ? { vendedor: e.vendedor } : {}),
          // Siempre lo de la última: si cambian el envío, interesa lo de ahora.
          ...(e.campos ? { campos: e.campos } : {}),
          ...(e.costo != null ? { costo: e.costo } : {}),
        },
      });
    } catch {
      // A propósito. Ver el comentario de arriba.
    }
  }
}
