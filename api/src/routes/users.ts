import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { normalizarUsuario } from '../lib/nombreUsuario';
import prisma from '../prismaClient';
import { getRequesterContext, resolveSucursalScope } from '../lib/sucursalContext';
import { emitEvent } from '../lib/events';

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
    if (sucursalError) return res.status(403).json({ error: sucursalError });
    if (!sucursalId && !requester.isGlobalAdmin) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para consultar usuarios.' });
    }

    const users = await prisma.usuario.findMany({
      where: sucursalId ? { sucursalId } : {},
      include: {
        rol: true,
        sucursal: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Remove password from response
    const usersWithoutPassword = users.map(({ password, ...user }) => user);

    res.json(usersWithoutPassword);
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
    if (sucursalError) return res.status(403).json({ error: sucursalError });
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
      return res.status(404).json({ error: 'User not found' });
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
      return res.status(403).json({ error: sucursalError });
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
      return res.status(403).json({ error: sucursalError });
    }
    if (!requester.isGlobalAdmin && !activeSucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para actualizar usuarios.' });
    }

    const existingUser = await prisma.usuario.findFirst({
      where: activeSucursalId ? { id, sucursalId: activeSucursalId } : { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
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
    }
    res.json(userWithoutPassword);
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
      return res.status(403).json({ error: sucursalError });
    }
    if (!getRequesterContext(req).isGlobalAdmin && !sucursalId) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada para eliminar usuarios.' });
    }

    const existingUser = await prisma.usuario.findFirst({
      where: sucursalId ? { id, sucursalId } : { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.usuario.delete({
      where: { id },
    });

    emitEvent('usuario', { sucursalId: existingUser.sucursalId, id, accion: 'delete' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
