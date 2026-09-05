import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { normalizarUsuario } from '../lib/nombreUsuario';
import prisma from '../prismaClient';
import { decidirBorrado } from '../lib/borradoUsuario';
import { getRequesterContext, resolveSucursalScope } from '../lib/sucursalContext';
import { emitEvent } from '../lib/events';
import { ROLES_ENLAZABLES, backfillSucursalDeVendedor } from '../lib/gestores';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const requester = getRequesterContext(req);
    if (!requester.canManageUsers) {
      return res.status(403).json({ error: 'No tienes permiso para gestionar usuarios.' });
    }
    // Super Admin sin selección -> null = todas las sucursales.
    // Administrador -> siempre la suya (preferUserSucursal).
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: true,
    });
    if (sucursalError) return res.status(400).json({ error: sucursalError });
    if (!sucursalId && !requester.isGlobalAdmin) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para consultar usuarios.' });
    }

    // PAGINADO EN EL SERVIDOR. Antes devolvia la lista ENTERA en cada carga:
    // 164 usuarios con su rol y su sucursal, 63 KB. En el servidor son 70 ms,
    // pero por un enlace de sucursal —Starlink, ~600 ms de ida y vuelta— eso es
    // la espera larga que se notaba al cambiar a "todas las sucursales", mas
    // pintar 164 filas de golpe en un equipo modesto.
    //
    // Los filtros tambien van aqui y no en el navegador: filtrar en el cliente
    // obliga a bajarlo todo primero, que es justo lo que se quiere evitar.
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = (req.query.search as string)?.trim();
    const rol = (req.query.rol as string)?.trim();

    const where: any = sucursalId ? { sucursalId } : {};

    if (rol) where.rol = { nombre: rol };
    if (search) {
      // `insensitive` para que buscar "ana" encuentre "Ana". Los nombres de
      // usuario ya se guardan sin tildes, asi que no hace falta mas.
      where.username = { contains: search, mode: 'insensitive' };
    }

    const [users, total] = await Promise.all([
      prisma.usuario.findMany({
        where,
        include: { rol: true, sucursal: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.usuario.count({ where }),
    ]);

    // Remove password from response
    const usersWithoutPassword = users.map(({ password, ...user }) => user);

    res.json({
      data: usersWithoutPassword,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const requester = getRequesterContext(req);
    if (!requester.canManageUsers) {
      return res.status(403).json({ error: 'No tienes permiso para gestionar usuarios.' });
    }
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: true,
    });
    if (sucursalError) return res.status(400).json({ error: sucursalError });
    if (!sucursalId && !requester.isGlobalAdmin) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para consultar usuarios.' });
    }

    const user = await prisma.usuario.findFirst({
      where: sucursalId ? { id, sucursalId } : { id },
      include: {
        rol: true,
        sucursal: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Ese usuario no existe o no es de tu sucursal.' });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    res.json(userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    const { username: rawUsername, password, rolId, sucursalId: incomingSucursalId } = req.body;
    // Se normaliza IGUAL que en el login: sin espacios al borde y las tildes en
    // NFC. Antes solo se hacia trim aqui, y el login ni eso, asi que un usuario
    // con tilde tecleada de otra forma no podia entrar nunca. Ver
    // lib/nombreUsuario.
    const username = normalizarUsuario(rawUsername);
    const requester = getRequesterContext(req);
    if (!requester.canManageUsers) {
      return res.status(403).json({ error: 'No tienes permiso para crear usuarios.' });
    }
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }
    if (!requester.isGlobalAdmin && !sucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para crear usuarios.' });
    }

    if (!requester.isGlobalAdmin && incomingSucursalId && incomingSucursalId !== sucursalId) {
      return res.status(400).json({ error: 'No puedes crear usuarios en otra sucursal desde este contexto' });
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    let roleName: string | null = null;
    if (rolId) {
      const selectedRole = await prisma.rol.findUnique({
        where: { id: rolId },
        select: { nombre: true },
      });

      if (!selectedRole) {
        return res.status(400).json({ error: 'Rol inválido' });
      }

      roleName = selectedRole.nombre;
    }

    const roleUpper = String(roleName || '').toUpperCase();
    const isSuperAdminRole = roleUpper === 'SUPER ADMIN';

    // Solo un Super Admin puede crear otro Super Admin.
    if (isSuperAdminRole && !requester.isSuperAdmin) {
      return res.status(403).json({ error: 'Solo un Super Admin puede crear otro Super Admin.' });
    }

    // El Super Admin es el ÚNICO global: va SIN sucursal (null). Todos los demás
    // roles (incluido Administrador, que ahora está scopeado) llevan sucursal.
    const targetSucursalId = isSuperAdminRole
      ? null
      : requester.isGlobalAdmin
        ? (incomingSucursalId || sucursalId || null)
        : (sucursalId || null);

    if (!isSuperAdminRole && !targetSucursalId) {
      return res.status(400).json({ error: 'Debes seleccionar una sucursal para este rol.' });
    }

    if (!isSuperAdminRole && targetSucursalId) {
      const targetSucursal = await prisma.sucursal.findUnique({
        where: { id: targetSucursalId },
        select: { id: true },
      });

      if (!targetSucursal) {
        return res.status(400).json({ error: 'La sucursal seleccionada no existe o ya no es válida.' });
      }
    }

    // El nombre debe ser ÚNICO aunque cambie la mayúscula/minúscula: así no se crean dos
    // usuarios "iguales" (ej. "Ernesto" y "ernesto") y el que crea recibe un aviso claro.
    const existingUser = await prisma.usuario.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });

    if (existingUser) {
      return res.status(409).json({
        error: `El nombre de usuario "${existingUser.username}" ya está en uso. Elige otro.`,
      });
    }

    // Dos usuarios que solo se diferencien en las mayusculas ("Sidney" y "sidney")
    // se leen como el mismo y nadie sabria en cual esta su contrasenia. Ademas
    // dejarian ciega a la busqueda tolerante del login, que ante dos candidatos
    // no adivina: prefiere fallar antes que meter a alguien en la cuenta de otro.
    const choque = await prisma.usuario.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { username: true },
    });

    if (choque) {
      return res.status(400).json({
        error: `Ya existe el usuario "${choque.username}". Los nombres no distinguen mayusculas: elige otro.`,
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.usuario.create({
      data: {
        username,
        password: hashedPassword,
        rolId: rolId || null,
        sucursalId: targetSucursalId || null,
      },
      include: {
        rol: true,
        sucursal: true,
      },
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    emitEvent('usuario', {
      sucursalId: user.sucursalId,
      id: user.id,
      accion: 'create',
      datos: userWithoutPassword,
    });
    res.status(201).json(userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, rolId, sucursalId } = req.body;
    const requester = getRequesterContext(req);
    if (!requester.canManageUsers) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar usuarios.' });
    }
    const { sucursalId: activeSucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: true,
    });
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }
    if (!requester.isGlobalAdmin && !activeSucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para actualizar usuarios.' });
    }

      /**
       * UN SUPER ADMIN LLEGA A CUALQUIER USUARIO, ESTÉ EN LA SUCURSAL QUE ESTÉ.
       *
       * Antes esto se acotaba también para él por la sucursal activa del panel. La
       * lista se le enseña entera —puede elegir «todas»— así que veía a todo el mundo
       * y, al abrir uno de otra sucursal, la búsqueda no lo encontraba y salía
       * «User not found»: un mensaje que manda a pensar que el usuario no existe
       * cuando existe y se está mirando en ese momento.
       *
       * Para los demás el acotado se queda: un administrador de sucursal no puede
       * tocar los usuarios de otra.
       */
    const existingUser = await prisma.usuario.findFirst({
      where: !requester.isGlobalAdmin && activeSucursalId ? { id, sucursalId: activeSucursalId } : { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'Ese usuario no existe o no es de tu sucursal.' });
    }

    const updateData: any = {};
    let pasaASuperAdmin = false;

    if (username) updateData.username = String(username).trim();
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (rolId !== undefined) {
      if (rolId === null) {
        updateData.rolId = null;
      } else {
        const selectedRole = await prisma.rol.findUnique({
          where: { id: rolId },
          select: { id: true, nombre: true },
        });

        if (!selectedRole) {
          return res.status(400).json({ error: 'Rol inválido' });
        }

        // Solo un Super Admin puede otorgar (o quitar) el rol de Super Admin.
        if (
          String(selectedRole.nombre).toUpperCase() === 'SUPER ADMIN' &&
          !requester.isSuperAdmin
        ) {
          return res.status(403).json({ error: 'Solo un Super Admin puede asignar el rol Super Admin.' });
        }

        updateData.rolId = rolId;
        pasaASuperAdmin = String(selectedRole.nombre).toUpperCase() === 'SUPER ADMIN';
      }
    }
    if (!requester.isGlobalAdmin && sucursalId !== undefined && sucursalId !== activeSucursalId) {
      return res.status(400).json({ error: 'No puedes mover usuarios a otra sucursal desde este contexto' });
    }
    if (sucursalId !== undefined) {
      if (sucursalId === null || sucursalId === '') {
        updateData.sucursalId = null;
      } else {
        const targetSucursal = await prisma.sucursal.findUnique({
          where: { id: sucursalId },
          select: { id: true },
        });

        if (!targetSucursal) {
          return res.status(400).json({ error: 'La sucursal seleccionada no existe o ya no es válida.' });
        }

        updateData.sucursalId = sucursalId;
      }
    }

    // Va AL FINAL, después del bloque de sucursal, para que gane: el Super Admin
    // es el único rol GLOBAL y no pertenece a ninguna sucursal. Al promover a
    // alguien se le quitaba nada y seguía saliendo con la vieja (Claudia figurando
    // en Camagüey siendo global), y el backend se la aplicaba como filtro.
    if (pasaASuperAdmin) updateData.sucursalId = null;

    /**
     * CAMBIAR DE SUCURSAL A UN USUARIO SE LLEVA A LOS SUYOS.
     *
     * La ingesta ya funciona así: la sucursal del vendedor sale de SU GESTOR, y la del
     * cliente sale del gestor del vendedor que trae el pedido. Pero eso sólo se aplica
     * en la importación siguiente, así que entre medias el usuario está en la sucursal
     * nueva y sus vendedores y pedidos siguen figurando en la vieja. Alguien mira, no
     * cuadra, y lo vuelve a cambiar.
     *
     * Aquí no se inventa una regla: se aplica la misma, ya.
     *
     * # Los CLIENTES SUYOS se van con él; los PEDIDOS se quedan
     *
     * El cliente le corresponde al vendedor, así que se lo lleva. Los pedidos no: lo que
     * ya se vendió se queda contado donde se vendió, y por eso aquí no se toca ni uno.
     *
     * Suyos quiere decir **en exclusiva**. Un cliente puede comprarle a varios
     * vendedores —hoy 1.160 lo hacen— y ése no es de nadie: arrastrarlo detrás de éste
     * se lo quita a los otros, que siguen atendiéndolo desde la sucursal de antes. Los
     * compartidos se quedan y se cuentan aparte, para que quien traspasa sepa qué no se
     * movió en vez de enterarse por un informe descuadrado.
     */
    const cambiaDeSucursal =
      updateData.sucursalId !== undefined && updateData.sucursalId !== existingUser.sucursalId;
    const arrastre = { vendedores: 0, clientes: 0, clientesCompartidos: 0 };

    if (cambiaDeSucursal) {
      const destino = (updateData.sucursalId as string | null) ?? null;
      const suyos = await prisma.vendedor.findMany({
        where: { gestorId: id },
        select: { id: true },
      });
      const ids = suyos.map((v) => v.id);

      if (ids.length) {
        const compradores = await prisma.pedido.findMany({
          where: { vendedorId: { in: ids }, clienteId: { not: null } },
          select: { clienteId: true },
          distinct: ['clienteId'],
        });
        const clientes = compradores.map((p) => p.clienteId!).filter(Boolean);

        // Los que le compran además a otro vendedor NO son suyos: se quedan.
        const compartidos = clientes.length
          ? (
              await prisma.pedido.findMany({
                where: { clienteId: { in: clientes }, vendedorId: { notIn: ids } },
                select: { clienteId: true },
                distinct: ['clienteId'],
              })
            ).map((p) => p.clienteId!)
          : [];
        const soloSuyos = clientes.filter((c) => !compartidos.includes(c));

        await prisma.$transaction([
          prisma.vendedor.updateMany({ where: { id: { in: ids } }, data: { sucursalId: destino } }),
          ...(soloSuyos.length
            ? [prisma.cliente.updateMany({ where: { id: { in: soloSuyos } }, data: { sucursalId: destino } })]
            : []),
        ]);

        arrastre.vendedores = ids.length;
        arrastre.clientes = soloSuyos.length;
        arrastre.clientesCompartidos = compartidos.length;
      }
    }

    const user = await prisma.usuario.update({
      where: { id },
      data: updateData,
      include: {
        rol: true,
        sucursal: true,
      },
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // El usuario viaja COMPLETO (sin contraseña) para que la vista lo sustituya en
    // sitio. Si cambió de sucursal se emite también a la anterior, que si no se
    // quedaba enseñándolo: el SSE filtra por sucursal y no le llegaría el evento.
    for (const scope of new Set([user.sucursalId, existingUser.sucursalId])) {
      emitEvent('usuario', {
        sucursalId: scope,
        id: user.id,
        accion: 'update',
        datos: userWithoutPassword,
      });
      // Y que las listas de vendedores y clientes de LAS DOS sucursales se recarguen:
      // acaban de cambiar de sitio y quien las tenga abiertas vería lo de antes.
      if (cambiaDeSucursal && arrastre.vendedores > 0) {
        emitEvent('vendedor', { sucursalId: scope, accion: 'bulk' });
        emitEvent('cliente', { sucursalId: scope, accion: 'bulk' });
      }
    }

    // Se dice QUÉ se movió con él. Un traspaso silencioso obliga a ir a mirar a otras
    // dos pantallas para saber si funcionó.
    res.json(cambiaDeSucursal ? { ...userWithoutPassword, arrastre } : userWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursalId, error: sucursalError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: false,
      defaultAllForAdmin: true,
    });
    if (sucursalError) {
      return res.status(400).json({ error: sucursalError });
    }
    if (!getRequesterContext(req).isGlobalAdmin && !sucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para eliminar usuarios.' });
    }

    // Mismo criterio que al editar: el Super Admin llega a cualquiera; los demás,
    // sólo a los de su sucursal.
    const existingUser = await prisma.usuario.findFirst({
      where: !getRequesterContext(req).isGlobalAdmin && sucursalId ? { id, sucursalId } : { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'Ese usuario no existe o no es de tu sucursal.' });
    }

    // Un usuario que lleva vendedores NO se puede borrar sin reasignarlos antes.
    //
    // La relación Vendedor.gestor es opcional y sin onDelete, así que Prisma usaba
    // SetNull: al borrar el usuario, sus vendedores quedaban "Sin asignar" EN
    // SILENCIO. Todo lo que subieran a partir de ese momento se guardaba sin
    // sucursal y desaparecía de la vista, sin ningún aviso.
    //
    // Pasó en Holguín el 08/08/2026: el administrador borró los usuarios que venían
    // de Parranda y creó otros. Sus vendedores quedaron huérfanos y los pedidos
    // dejaron de verse. Ahora se bloquea y se dice exactamente a quién afecta.
    const vendedoresACargo = await prisma.vendedor.findMany({
      where: { gestorId: id },
      select: {
        id: true, nombre: true, codigo: true, activo: true, sucursalId: true,
        _count: { select: { pedidos: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    const decision = decidirBorrado(vendedoresACargo);

    /**
     * SÓLO BLOQUEA SI ALGUNO SIGUE ACTIVO.
     *
     * Un vendedor activo sin gestor es el fallo de Holguín: la ingesta le pone la
     * sucursal de su gestor, y sin gestor se la deja en nulo. Queda «sin asignar», y
     * todo lo que suba a partir de ahí desaparece de la vista sin un aviso.
     *
     * Uno de baja no tiene ese problema: su CSV ya no llega —la ingesta lo rechaza— así
     * que nadie le va a tocar la sucursal. Puede quedarse sin usuario tranquilamente.
     */
    if (!decision.permitido) {
      return res.status(409).json({
        error:
          `No se puede eliminar: ${existingUser.username} lleva ${decision.activos.length} vendedor(es) en activo. ` +
          'Dales de baja o reasígnalos a otro usuario primero.',
        codigo: 'VENDEDORES_ASIGNADOS',
        vendedores: decision.activos.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          codigo: v.codigo,
          pedidos: v._count.pedidos,
        })),
      });
    }

    /**
     * LOS DE BAJA SE QUEDAN, CON SU SUCURSAL Y SIN USUARIO.
     *
     * Borrar el usuario no puede llevarse por delante lo que ya se recogió: sus pedidos,
     * sus clientes y su histórico siguen haciendo falta para hacer seguimiento aunque esa
     * persona ya no trabaje.
     *
     * Así que el vendedor no se borra ni se vacía: pierde el gestor y **conserva la
     * sucursal a la que pertenecía**. Sin eso quedaría «sin asignar» y sus pedidos
     * saldrían de los informes de esa sucursal, que es justo el histórico que se quiere
     * conservar.
     */
    if (decision.aLiberar.length) {
      await prisma.vendedor.updateMany({
        where: { id: { in: decision.aLiberar.map((v) => v.id) } },
        data: { gestorId: null },
      });
    }

    await prisma.usuario.delete({
      where: { id },
    });

    emitEvent('usuario', { sucursalId: existingUser.sucursalId, id, accion: 'delete' });
    if (vendedoresACargo.length) {
      emitEvent('vendedor', { sucursalId: existingUser.sucursalId, accion: 'bulk' });
    }

    // Se dice QUÉ quedó, no sólo que se borró: el que lo hace tiene que saber que esos
    // vendedores siguen ahí, de baja y con su sucursal, con todo su histórico.
    res.json({
      message: 'User deleted successfully',
      vendedoresLiberados: vendedoresACargo.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        codigo: v.codigo,
        pedidos: v._count.pedidos,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /users/:id/vendedores
// Qué bloquea el borrado de este usuario y a quién se le puede pasar.
// La vista lo pide ANTES de borrar, para enseñar el problema y su solución en la
// misma pantalla en vez de soltar un error y dejar al usuario sin salida.
router.get('/:id/vendedores', async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, username: true, sucursalId: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const [vendedores, candidatos] = await Promise.all([
      prisma.vendedor.findMany({
        where: { gestorId: id },
        select: { id: true, nombre: true, codigo: true, _count: { select: { pedidos: true } } },
        orderBy: { nombre: 'asc' },
      }),
      // Solo de la MISMA sucursal: pasarle un vendedor a un gestor de otra movería
      // sus pedidos y clientes de sucursal sin que nadie lo haya pedido.
      prisma.usuario.findMany({
        where: {
          id: { not: id },
          sucursalId: usuario.sucursalId,
          rol: { nombre: { in: ROLES_ENLAZABLES } },
        },
        // Usuario no tiene campo `nombre`: se identifica por username.
        select: { id: true, username: true },
        orderBy: { username: 'asc' },
      }),
    ]);

    res.json({
      usuario,
      vendedores: vendedores.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        codigo: v.codigo,
        pedidos: v._count.pedidos,
      })),
      candidatos,
      sePuedeEliminar: vendedores.length === 0,
    });
  } catch (err) {
    console.error('Error listando vendedores del usuario:', err);
    res.status(500).json({ error: 'Error al consultar los vendedores del usuario' });
  }
});

// POST /users/:id/reasignar-vendedores   body: { gestorId }
// Pasa TODOS los vendedores de este usuario a otro gestor, dejándolo libre para
// poder borrarse. Va en una sola transacción: o se mueven todos o no se mueve
// ninguno, para que no queden vendedores a medio camino si algo falla.
router.post('/:id/reasignar-vendedores', async (req, res) => {
  try {
    const { id } = req.params;
    const { gestorId } = req.body as { gestorId?: string };

    if (!getRequesterContext(req).isGlobalAdmin) {
      const { sucursalId, error } = resolveSucursalScope(req, {
        allowAllForAdmin: true,
        preferUserSucursal: false,
        defaultAllForAdmin: true,
      });
      if (error) return res.status(403).json({ error });
      const propio = await prisma.usuario.findFirst({ where: { id, sucursalId } });
      if (!propio) return res.status(403).json({ error: 'Ese usuario es de otra sucursal.' });
    }

    if (!gestorId) return res.status(400).json({ error: 'Falta el gestor destino' });
    if (gestorId === id) {
      return res.status(400).json({ error: 'No se puede reasignar al mismo usuario' });
    }

    const destino = await prisma.usuario.findUnique({
      where: { id: gestorId },
      include: { rol: true },
    });
    if (!destino) return res.status(404).json({ error: 'El usuario destino no existe' });
    if (!ROLES_ENLAZABLES.includes(destino.rol?.nombre ?? '')) {
      return res.status(400).json({
        error: `Ese usuario no puede llevar vendedores: se requiere rol ${ROLES_ENLAZABLES.join(' o ')}.`,
      });
    }
    if (!destino.sucursalId) {
      return res.status(400).json({ error: 'El usuario destino no tiene sucursal asignada' });
    }

    const vendedores = await prisma.vendedor.findMany({
      where: { gestorId: id },
      select: { id: true },
    });
    if (!vendedores.length) {
      return res.json({ movidos: 0, backfill: { pedidos: 0, clientes: 0, fusionados: 0 } });
    }

    const total = { pedidos: 0, clientes: 0, fusionados: 0 };

    await prisma.$transaction(async (tx) => {
      for (const v of vendedores) {
        await tx.vendedor.update({
          where: { id: v.id },
          data: { gestorId: destino.id, sucursalId: destino.sucursalId },
        });
        // Mismo backfill que al enlazar un gestor a mano: los pedidos y clientes
        // del vendedor tienen que acabar en la sucursal del nuevo gestor.
        const bf = await backfillSucursalDeVendedor(tx, v.id, destino.sucursalId as string);
        total.pedidos += bf.pedidos;
        total.clientes += bf.clientes;
        total.fusionados += bf.fusionados;
      }
    });

    emitEvent('vendedor', { sucursalId: destino.sucursalId, accion: 'reasignar' });
    if (total.pedidos > 0) emitEvent('pedido', { sucursalId: destino.sucursalId, accion: 'backfill' });
    if (total.clientes > 0 || total.fusionados > 0) {
      emitEvent('cliente', { sucursalId: destino.sucursalId, accion: 'backfill' });
    }

    res.json({ movidos: vendedores.length, backfill: total });
  } catch (err) {
    console.error('Error reasignando vendedores:', err);
    res.status(500).json({ error: 'Error al reasignar los vendedores' });
  }
});

export default router;
