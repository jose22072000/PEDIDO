import prisma from '../prismaClient';

// Días que un pedido EXPIRADO espera antes de archivarse (se guarda el histórico).
const DIAS_GRACIA_EXPIRADOS = 7;

/**
 * Archiva (soft-delete) los pedidos que ya no deben ocupar la lista activa:
 *  - COMPLETADOS: se archivan de una vez (la lista solo muestra "en proceso").
 *  - EXPIRADOS: los NO completados cuya fecha comprometida pasó hace más de una semana.
 * No se borran: quedan con `archivedAt` para reportes/histórico.
 * Idempotente: solo toca los que aún tienen `archivedAt = null`.
 */
export async function archivarPedidos(): Promise<{ completados: number; expirados: number }> {
  const ahora = new Date();
  const corteExpirados = new Date(ahora.getTime() - DIAS_GRACIA_EXPIRADOS * 24 * 60 * 60 * 1000);

  const completados = await prisma.pedido.updateMany({
    where: { archivedAt: null, estado: 'completada' },
    data: { archivedAt: ahora },
  });

  const expirados = await prisma.pedido.updateMany({
    where: {
      archivedAt: null,
      fecha_comprometida: { not: null, lt: corteExpirados },
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
