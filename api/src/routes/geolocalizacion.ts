import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import xlsx from 'xlsx';

import prisma from '../prismaClient';
import { getRequesterContext, resolveSucursalScope } from '../lib/sucursalContext';

/**
 * Subida del "Consolidado de Geolocalización" que entrega Parranda.
 *
 * Es lo mismo que hacía `import-geolocalizacion.mjs` por consola, pero desde la UI.
 * NO crea clientes: solo rellena los datos (dirección, municipio, tipo, estado y
 * lat/lng) de los que ya existen, matcheando por NOMBRE dentro de cada sucursal.
 *
 * La lat/lng es lo que permite a delivery calcular el costo del domicilio: un cliente
 * sin ella no se puede cotizar.
 */
const router = Router();
const upload = multer({ dest: 'uploads/temp' });

// Normaliza para matchear pese a mayúsculas, tildes y espacios dobles.
const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

// Código de provincia (columna "Sucursal" del xlsx) -> alias del nombre de la sucursal.
const PROVINCIAS: Record<string, string[]> = {
  CAM: ['CAMAGUEY'],
  GTO: ['GUANTANAMO'],
  HAB: ['HABANA', 'LA HABANA', 'HAVANA'],
  HOL: ['HOLGUIN'],
  SS: ['SANCTI SPIRITUS', 'SANCTI-SPIRITUS', 'ESPIRITUS'],
  STG: ['SANTIAGO', 'SANTIAGO DE CUBA'],
  TUN: ['LAS TUNAS', 'TUNAS'],
};

function resolveCode(nombreSucursal: string): string | null {
  const n = norm(nombreSucursal);
  for (const [code, aliases] of Object.entries(PROVINCIAS)) {
    if (n === code) return code;
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return code;
  }
  return null;
}

// Extrae [lat, lng]; si las celdas no vienen como número, reintenta con el texto crudo
// (arregla los que traen punto en vez de coma, o un punto final).
function parseGeo(lat: unknown, lng: unknown, raw: unknown) {
  const okNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (okNum(lat) && okNum(lng)) return { lat, lng, recuperada: false };
  if (typeof raw === 'string') {
    const nums = raw.match(/-?\d{1,3}\.\d+/g);
    if (nums && nums.length >= 2) {
      const la = parseFloat(nums[0]);
      const ln = parseFloat(nums[1]);
      if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
        return { lat: la, lng: ln, recuperada: true };
      }
    }
  }
  return { lat: null, lng: null, recuperada: false };
}

/**
 * POST /geolocalizacion   (multipart: file=<xlsx>,  ?dry=1 para simular)
 * Enriquece los clientes de las sucursales que el usuario puede ver.
 */
// El cast es necesario: multer arrastra su propio @types/express y choca con el del
// proyecto. Es solo un problema de tipos; en runtime el middleware funciona igual.
router.post('/', upload.single('file') as any, async (req, res) => {
  const archivo = (req as any).file as { path: string } | undefined;
  const tmp = archivo?.path;
  try {
    if (!archivo) return res.status(400).json({ error: 'Falta el archivo .xlsx' });

    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const requester = getRequesterContext(req);
    const { sucursalId, error: scopeError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: true,
    });
    if (scopeError) return res.status(403).json({ error: scopeError });
    if (!sucursalId && !requester.isGlobalAdmin) {
      return res.status(400).json({ error: 'Debes tener una sucursal asignada.' });
    }

    const wb = xlsx.readFile(archivo.path);
    const ws = wb.Sheets['Consolidado'];
    if (!ws) {
      return res.status(400).json({ error: 'El archivo no tiene la hoja "Consolidado".' });
    }

    const rows = xlsx.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
    // Columnas: 0 Sucursal · 1 Nombre · 2 Dirección · 3 Municipio · 4 Tipo · 5 Estado ·
    //           6 geoRaw · 7 Lat · 8 Lng
    const filasPorCodigo = new Map<string, any[]>();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const code = norm(row[0]);
      if (!filasPorCodigo.has(code)) filasPorCodigo.set(code, []);
      filasPorCodigo.get(code)!.push(row);
    }

    // Solo las sucursales que este usuario puede tocar.
    const sucursales = await prisma.sucursal.findMany({
      where: sucursalId ? { id: sucursalId } : {},
    });

    const detalle: any[] = [];
    const total = { match: 0, actualizados: 0, conGeo: 0, sinGeo: 0, sinMatch: 0 };

    for (const suc of sucursales) {
      const code = (suc.codigo ? norm(suc.codigo) : null) || resolveCode(suc.nombre);
      const filas = code ? filasPorCodigo.get(code) ?? [] : [];
      if (!code || filas.length === 0) {
        detalle.push({ sucursal: suc.nombre, codigo: code, filas: 0, saltada: true });
        continue;
      }

      const clientes = await prisma.cliente.findMany({ where: { sucursalId: suc.id } });
      const porNombre = new Map<string, (typeof clientes)[number]>();
      for (const c of clientes) {
        const k = norm(c.nombre);
        if (!porNombre.has(k)) porNombre.set(k, c);
      }

      const st = { sucursal: suc.nombre, codigo: code, filas: filas.length, clientes: clientes.length, match: 0, actualizados: 0, conGeo: 0, geoRecuperada: 0, sinGeo: 0, sinMatch: 0, sinMatchEjemplos: [] as string[] };

      for (const row of filas) {
        const [, nombre, direccion, municipio, tipo, estado, geoRaw, lat, lng] = row;
        const cli = porNombre.get(norm(nombre));
        if (!cli) {
          st.sinMatch++;
          if (st.sinMatchEjemplos.length < 5) st.sinMatchEjemplos.push(String(nombre));
          continue;
        }
        st.match++;
        const g = parseGeo(lat, lng, geoRaw);
        if (g.lat != null && g.lng != null) {
          st.conGeo++;
          if (g.recuperada) st.geoRecuperada++;
        } else st.sinGeo++;

        if (!dry) {
          await prisma.cliente.update({
            where: { id: cli.id },
            data: {
              direccion: (direccion ?? cli.direccion) || null,
              municipio: (municipio ?? cli.municipio) || null,
              tipoCliente: (tipo ?? cli.tipoCliente) || null,
              estadoCompra: (estado ?? cli.estadoCompra) || null,
              geolocalizacion: (geoRaw ?? cli.geolocalizacion) || null,
              latitud: g.lat ?? cli.latitud,
              longitud: g.lng ?? cli.longitud,
            },
          });
        }
        st.actualizados++;
      }

      total.match += st.match;
      total.actualizados += st.actualizados;
      total.conGeo += st.conGeo;
      total.sinGeo += st.sinGeo;
      total.sinMatch += st.sinMatch;
      detalle.push(st);
    }

    const conGeoAhora = await prisma.cliente.count({
      where: { latitud: { not: null }, ...(sucursalId ? { sucursalId } : {}) },
    });
    const totalClientes = await prisma.cliente.count({ where: sucursalId ? { sucursalId } : {} });

    res.json({ dry, total, detalle, clientesConGeo: conGeoAhora, clientesTotal: totalClientes });
  } catch (err) {
    console.error('Error importando geolocalización:', err);
    res.status(500).json({ error: 'No se pudo procesar el archivo.' });
  } finally {
    if (tmp) fs.promises.unlink(tmp).catch(() => {});
  }
});

export default router;
