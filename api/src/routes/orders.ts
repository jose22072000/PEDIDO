import { Router } from 'express';
import prisma from '../prismaClient';
import fs from 'fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';

function slugify(input: string) {
  return input
    .toString()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function uniqueParrandaId(base: string) {
  let candidate = base;
  let i = 1;
  while (true) {
    const existing = await prisma.client.findFirst({ where: { parrandaId: candidate } });
    if (!existing) return candidate;
    i += 1;
    candidate = `${base}-${i}`;
  }
}

const router = Router();

// List orders with items, client and seller
router.get('/', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true, client: true, seller: true }
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Create a new order (basic)
router.post('/', async (req, res) => {
  try {
    const { folio, sellerId, clientId, direccion, encargado, telefono, fecha, fecha_comprometida, items } = req.body;

    const order = await prisma.order.create({
      data: {
        folio,
        sellerId: sellerId || null,
        clientId: clientId || null,
        direccion: direccion || null,
        encargado: encargado || null,
        telefono: telefono || null,
        fecha: fecha ? new Date(fecha) : new Date(),
        fecha_comprometida: fecha_comprometida ? new Date(fecha_comprometida) : null,
        items: {
          create: (items || []).map((it: any) => ({
            producto: it.producto,
            unidades: Number(it.unidades || 0),
            descripcion: it.descripcion || null,
          })),
        },
      },
      include: { items: true }
    });

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

export default router;
