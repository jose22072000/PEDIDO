import prisma from '../prismaClient';

/**
 * Normaliza un nombre de usuario para poder compararlo.
 *
 * Un usuario recien creado no podia entrar y daba "Invalid credentials". El alta
 * hacia `trim()` y el login NO, y ninguno de los dos tocaba las tildes ni las
 * mayusculas. Reproducido contra el servidor, fallaban tres casos reales:
 *
 *   - un espacio al final (copiar y pegar el usuario del chat)  -> 401
 *   - la tilde tecleada en NFD en vez de NFC                    -> 401
 *   - "Sidney" escrito "sidney"                                 -> 401
 *
 * Lo de la tilde es el peor de los tres porque no se ve: "gonzález" con la tilde
 * como caracter propio y "gonzález" con la tilde combinada se pintan IGUAL en
 * pantalla y son cadenas distintas. Segun el teclado y el sistema, el navegador
 * manda una u otra. Cuatro usuarios reales tienen tilde en el nombre.
 *
 * NFC junta el caracter y su tilde en uno solo, que es como los guarda Postgres
 * cuando el alta viene del panel.
 */
export function normalizarUsuario(valor: unknown): string {
  return typeof valor === 'string' ? valor.normalize('NFC').trim() : '';
}

/**
 * Busca el usuario para el login, tolerando mayusculas y tildes.
 *
 * Primero se intenta la coincidencia EXACTA, que es el caso normal y usa el
 * indice unico. Solo si no aparece se busca sin distinguir mayusculas, y
 * unicamente se acepta si hay UNA sola coincidencia: si hubiera dos usuarios que
 * solo se diferencian en las mayusculas, adivinar cual es seria peor que fallar
 * — entraria en la cuenta equivocada, con los permisos de otro.
 */
export async function buscarUsuarioParaLogin(username: string) {
  const exacto = await prisma.usuario.findUnique({
    where: { username },
    include: { rol: true, sucursal: true },
  });

  if (exacto) return exacto;

  const parecidos = await prisma.usuario.findMany({
    where: { username: { equals: username, mode: 'insensitive' } },
    include: { rol: true, sucursal: true },
    take: 2,
  });

  return parecidos.length === 1 ? parecidos[0] : null;
}
