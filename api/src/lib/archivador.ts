import prisma from '../prismaClient';

// Una semana de gracia: los completados se archivan 7 días DESPUÉS de completarse, y los
// expirados 7 días después de su fecha comprometida. Así la lista no acumula lo viejo pero
// lo reciente sigue visible.
const DIAS_GRACIA = 7;

/**
 * Archiva (soft-delete) los pedidos que ya no deben ocupar la lista activa:
 *  - COMPLETADOS: los completados hace más de una semana (por `completedAt`). Si no tiene
 *    `completedAt` (datos viejos), se usa su fecha comprometida como referencia.
 *  - EXPIRADOS: los NO completados cuya fecha comprometida pasó hace más de una semana.
 * No se borran: quedan con `archivedAt` para reportes/histórico.
 * Idempotente: solo toca los que aún tienen `archivedAt = null`.
 */
export async function archivarPedidos(): Promise<{ completados: number; expirados: number }> {
  const ahora = new Date();
  const corte = new Date(ahora.getTime() - DIAS_GRACIA * 24 * 60 * 60 * 1000);

  const completados = await prisma.pedido.updateMany({
    where: {
      archivedAt: null,
      estado: 'completada',
      OR: [
        { completedAt: { not: null, lt: corte } },
        // Compatibilidad: completados sin completedAt -> por fecha comprometida.
        { completedAt: null, fecha_comprometida: { not: null, lt: corte } },
      ],
    },
    data: { archivedAt: ahora },
  });

  const expirados = await prisma.pedido.updateMany({
    where: {
      archivedAt: null,
      fecha_comprometida: { not: null, lt: corte },
      OR: [{ estado: null }, { estado: { not: 'completada' } }],
    },
    data: { archivedAt: ahora },
  });

  return { completados: completados.count, expirados: expirados.count };
}

/**
 * Arranca el archivado automático: una pasada al inicio y luego cada hora.
 */
export function iniciarArchivadoAutomatico() {
  const correr = async () => {
    try {
      const r = await archivarPedidos();
      if (r.completados || r.expirados) {
        console.log(`[archivador] ${r.completados} completados y ${r.expirados} expirados archivados.`);
      }
    } catch (e) {
      console.error('[archivador] error:', e instanceof Error ? e.message : e);
    }
  };
  correr();
  setInterval(correr, 60 * 60 * 1000); // cada hora
}
