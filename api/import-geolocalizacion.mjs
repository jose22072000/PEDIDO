// Enriquece clientes EXISTENTES de PEDIDO con la geolocalización del
// Consolidado_Geolocalizacion.xlsx que entregó Parranda.
//
// Reglas (decididas con el usuario):
//  - NO crea clientes nuevos: solo rellena datos a los que ya existen.
//  - Match por NOMBRE normalizado + sucursal (igual que orders.ts, que ya
//    matchea clientes por nombre en mayúsculas dentro de la sucursal).
//  - PEDIDO puede tener 1..N sucursales. Por defecto recorre TODAS las que
//    existan en esta instalación y a cada una le mete SOLO las filas de su
//    provincia. Las iniciales de la columna "Sucursal" = provincia = sucursal.
//    Las provincias del archivo que no tengan sucursal aquí, se saltan.
//  - lat/lng quedan nullable: delivery calcula solo si existen; si no, se salta.
//
// Uso:
//   node import-geolocalizacion.mjs [--file ../../Consolidado_Geolocalizacion.xlsx] [--dry]
//   node import-geolocalizacion.mjs --sucursal <id|nombre> [--code CAM]   // solo una
//
//   --file      Ruta al xlsx. Default: ../../Consolidado_Geolocalizacion.xlsx (raíz del workspace).
//   --sucursal  Restringe a una sola sucursal de PEDIDO (id o nombre).
//   --code      Fuerza el código de provincia (si el nombre no se pudo mapear solo).
//   --dry       No escribe; solo reporta qué haría.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { createPrismaClient } from './prisma-node-client.mjs';

// Prisma 7 requiere adapter (ver prisma-node-client.mjs); ya no vale `new PrismaClient()`.
const prisma = createPrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args ----
function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const DRY = !!arg('dry', false);
const FILE = path.resolve(__dirname, arg('file', '../../Consolidado_Geolocalizacion.xlsx'));
const SUCURSAL_ARG = arg('sucursal');
const CODE_ARG = arg('code');

// Normaliza nombres para matchear pese a mayúsculas/acentos/espacios dobles.
const norm = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos combinados
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

// Mapeo código de provincia (columna "Sucursal" del xlsx) -> alias de nombre.
const PROVINCIAS = {
  CAM: ['CAMAGUEY'],
  GTO: ['GUANTANAMO'],
  HAB: ['HABANA', 'LA HABANA', 'HAVANA'],
  HOL: ['HOLGUIN'],
  SS: ['SANCTI SPIRITUS', 'SANCTI-SPIRITUS', 'ESPIRITUS'],
  STG: ['SANTIAGO', 'SANTIAGO DE CUBA'],
  TUN: ['LAS TUNAS', 'TUNAS'],
};

// Dado el nombre de una Sucursal de PEDIDO, resuelve su código de provincia.
function resolveCode(sucursalNombre) {
  const n = norm(sucursalNombre);
  for (const [code, aliases] of Object.entries(PROVINCIAS)) {
    if (n === code) return code; // el nombre YA es el código (ej: "CAM")
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return code;
  }
  return null;
}

// Extrae [lat, lng] de las celdas; si Latitud/Longitud no vienen, re-parsea el
// texto crudo (arregla los ~58 malformados con punto en vez de coma / punto final).
function parseGeo(lat, lng, raw) {
  const okNum = (n) => typeof n === 'number' && Number.isFinite(n);
  if (okNum(lat) && okNum(lng)) return { lat, lng, recovered: false };
  if (typeof raw === 'string') {
    const nums = raw.match(/-?\d{1,3}\.\d+/g);
    if (nums && nums.length >= 2) {
      const la = parseFloat(nums[0]);
      const ln = parseFloat(nums[1]);
      if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
        return { lat: la, lng: ln, recovered: true };
      }
    }
  }
  return { lat: null, lng: null, recovered: false };
}

// Enriquece los clientes de UNA sucursal con las filas de SU código de provincia.
async function enrichSucursal(sucursal, code, rowsByCode) {
  const rows = rowsByCode.get(code) || [];
  const clientes = await prisma.cliente.findMany({ where: { sucursalId: sucursal.id } });
  const byName = new Map();
  let dupNames = 0;
  for (const c of clientes) {
    const k = norm(c.nombre);
    if (byName.has(k)) dupNames++;
    else byName.set(k, c);
  }

  const st = { code, filas: rows.length, clientes: clientes.length, dupNames, match: 0, sinMatch: 0, actualizados: 0, conGeo: 0, geoRecuperada: 0, sinGeo: 0, sinMatchEjemplos: [] };

  for (const row of rows) {
    const [, nombre, direccion, municipio, tipo, estado, geoRaw, lat, lng] = row;
    const cli = byName.get(norm(nombre));
    if (!cli) {
      st.sinMatch++;
      if (st.sinMatchEjemplos.length < 5) st.sinMatchEjemplos.push(nombre);
      continue;
    }
    st.match++;
    const g = parseGeo(lat, lng, geoRaw);
    if (g.lat != null && g.lng != null) {
      st.conGeo++;
      if (g.recovered) st.geoRecuperada++;
    } else st.sinGeo++;

    const data = {
      direccion: direccion ?? cli.direccion ?? null,
      municipio: municipio ?? cli.municipio ?? null,
      tipoCliente: tipo ?? cli.tipoCliente ?? null,
      estadoCompra: estado ?? cli.estadoCompra ?? null,
      geolocalizacion: (geoRaw ?? cli.geolocalizacion) ?? null,
      latitud: g.lat ?? cli.latitud ?? null,
      longitud: g.lng ?? cli.longitud ?? null,
    };
    if (!DRY) await prisma.cliente.update({ where: { id: cli.id }, data });
    st.actualizados++;
  }
  return st;
}

async function main() {
  // 1) Leer el xlsx (hoja Consolidado) y agrupar filas por código de provincia
  const wb = xlsx.readFile(FILE);
  const ws = wb.Sheets['Consolidado'];
  if (!ws) throw new Error('El xlsx no tiene la hoja "Consolidado".');
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  // Col: 0 Sucursal, 1 Nombre, 2 Direccion, 3 Municipio, 4 Tipo, 5 Estado, 6 geoRaw, 7 Lat, 8 Lng
  const rowsByCode = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const code = norm(row[0]);
    if (!rowsByCode.has(code)) rowsByCode.set(code, []);
    rowsByCode.get(code).push(row);
  }
  console.log(`Archivo: ${FILE} ${DRY ? '[DRY-RUN]' : ''}`);
  console.log(`Provincias en el archivo: ${[...rowsByCode.entries()].map(([c, v]) => `${c}:${v.length}`).join(', ')}`);

  // 2) Sucursales de PEDIDO a procesar (todas, o solo la indicada)
  let sucursales = await prisma.sucursal.findMany();
  if (SUCURSAL_ARG && SUCURSAL_ARG !== true) {
    sucursales = sucursales.filter((s) => s.id === SUCURSAL_ARG || norm(s.nombre) === norm(SUCURSAL_ARG));
    if (!sucursales.length) throw new Error(`No encontré la sucursal "${SUCURSAL_ARG}" en PEDIDO.`);
  }
  console.log(`Sucursales en esta instalación: ${sucursales.length ? sucursales.map((s) => s.nombre).join(', ') : '(ninguna)'}\n`);

  // 3) Enriquecer cada sucursal existente con SU provincia
  const totales = { match: 0, actualizados: 0, conGeo: 0, geoRecuperada: 0, sinMatch: 0 };
  for (const suc of sucursales) {
    // Prioridad: --code (si es una sola) > sucursal.codigo > mapeo por nombre.
    const forced = CODE_ARG && CODE_ARG !== true && sucursales.length === 1 ? norm(CODE_ARG) : null;
    const code = forced || (suc.codigo ? norm(suc.codigo) : null) || resolveCode(suc.nombre);
    if (!code || !rowsByCode.has(code)) {
      console.log(`— ${suc.nombre}: sin datos en el archivo (código resuelto: ${code ?? 'no mapeado'}). Se salta.`);
      continue;
    }
    const st = await enrichSucursal(suc, code, rowsByCode);
    console.log(`— ${suc.nombre} [${code}]: ${st.match}/${st.filas} match · actualizados ${st.actualizados} · con geo ${st.conGeo} (recuperada ${st.geoRecuperada}) · sin match ${st.sinMatch}`);
    if (st.sinMatchEjemplos.length) console.log(`    sin match ej.: ${st.sinMatchEjemplos.join(' | ')}`);
    totales.match += st.match; totales.actualizados += st.actualizados; totales.conGeo += st.conGeo; totales.geoRecuperada += st.geoRecuperada; totales.sinMatch += st.sinMatch;
  }

  console.log('\n===== TOTAL =====');
  console.log(`Match: ${totales.match} · Actualizados: ${totales.actualizados}${DRY ? ' (dry-run)' : ''} · Con geo: ${totales.conGeo} (recuperada ${totales.geoRecuperada}) · Sin match: ${totales.sinMatch}`);
}

main()
  .catch((e) => {
    console.error('FALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
