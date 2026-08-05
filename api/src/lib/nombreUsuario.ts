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
 * Por eso el nombre de usuario va SIN TILDES. No es que no se pueda escribir
 * "gonzalez" con tilde: es que un nombre de usuario se TECLEA, y una letra que
 * se puede escribir de dos formas distintas —que ademas se pintan igual— es una
 * trampa. Quien la teclee de la otra forma no entra, y no hay manera de que se
 * de cuenta mirando la pantalla.
 *
 * La tilde va en el NOMBRE de la persona, que es lo que se enseña. En el
 * identificador con el que entra, no. (05/08/2026: habia 7 usuarios con tilde,
 * generados a partir del nombre real; se renombraron.)
 */
export function normalizarUsuario(valor: unknown): string {
  if (typeof valor !== 'string') return '';

  // Los ESPACIOS se guardan como "_". Un nombre de usuario con espacios de verdad
  // da problemas en todas partes: no se ven al final de la cadena, se pierden al
  // copiar y pegar, y dos espacios seguidos son indistinguibles de uno. Con "_" el
  // nombre es siempre una sola palabra y lo que se ve es lo que hay.
  //
  // Se aplica IGUAL al crear y al entrar, asi que quien teclee "liannet rodriguez"
  // con espacio entra igual que quien teclee "liannet_rodriguez".
  return valor
    .normalize('NFD')            // separa la letra de su tilde
    .replace(/[\u0300-\u036f]/g, '') // y tira la tilde
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Como se ENSENA un nombre de usuario: el "_" vuelve a ser el espacio que era.
 * Guardar y mostrar son cosas distintas — por dentro conviene una sola palabra,
 * y a la vista conviene leerse como un nombre.
 */
export function mostrarUsuario(username: string | null | undefined): string {
  return (username ?? '').replace(/_/g, ' ');
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
