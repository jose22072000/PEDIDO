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
export type IntentoDeEntrega = {
  folio: string | null;
  motivo: string | null;
  ok: boolean;
  pedidoId?: string | null;
  cliente?: string | null;
  costo?: number | null;
};

export async function apuntarIntentos(entradas: IntentoDeEntrega[]): Promise<void> {
  for (const e of entradas) {
    // Sin folio no hay nada que agrupar: son las entradas que ni siquiera dicen a qué
    // pedido van, y se apuntan bajo una etiqueta común para que se vean sin ensuciar.
    const folio = (e.folio || '').trim() || '(sin folio)';
    const motivo = e.ok ? '' : (e.motivo || 'no aplicada').trim();

    try {
      await prisma.entregaIntento.upsert({
        where: { folio_motivo: { folio, motivo } },
        create: {
          folio, motivo, ok: e.ok,
          pedidoId: e.pedidoId ?? null,
          cliente: e.cliente ?? null,
          costo: e.costo ?? null,
        },
        update: {
          intentos: { increment: 1 },
          ultimoAt: new Date(),
          // El pedido resuelto y el cliente se refrescan: si antes no se sabía cuál era y
          // ahora sí, interesa lo de ahora.
          ...(e.pedidoId ? { pedidoId: e.pedidoId } : {}),
          ...(e.cliente ? { cliente: e.cliente } : {}),
          ...(e.costo != null ? { costo: e.costo } : {}),
        },
      });
    } catch {
      // A propósito. Ver el comentario de arriba.
    }
  }
}
