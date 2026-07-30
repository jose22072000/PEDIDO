// Cliente de la API de Parranda (Retool) + sync de clientes hacia PEDIDO.
// Reemplaza el Consolidado_Geolocalizacion.xlsx: trae los clientes con geolocalización
// DIRECTA (lat,lng), paginado por `offset` (1000/página). El worker lo corre en segundo
// plano (secuencial, con pausa anti-ban), sin golpear la DB desde el request.
import prisma from '../prismaClient';
import { enqueueDeliveryOrders } from './queues';

const PARRANDA_URL = process.env.PARRANDA_API_URL || 'https://ccsa.retool.com/url/procovar';
const PARRANDA_KEY = process.env.PARRANDA_API_KEY || ''; // SECRETO: solo por env (nunca en repo)
const PAGE = 1000;
const PAUSA_MS = Number(process.env.PARRANDA_PAUSA_MS || 1000); // pausa entre páginas (anti-ban)

// provincia que manda la API  ->  código de sucursal (el interno, el del Consolidado).
// Se matchea por NOMBRE de provincia (no por el prefijo del codigo del cliente, que usa
// otro esquema: LH/CM/GU… ≠ HAB/CAM/GTO…).
const PROV_TO_CODE: Record<string, string> = {
  'santiago de cuba': 'STG',
  'la habana': 'HAB',
  'camaguey': 'CAM',
  'guantanamo': 'GTO',
  'las tunas': 'TUN',
  'holguin': 'HOL',
  'sancti spiritus': 'SS',
  'granma': 'GR',
};

// Normaliza: sin tildes, minúsculas, espacios simples. Para matchear provincia y nombre
// pese a mayúsculas/tildes/dobles espacios (típico de estos datos).
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParrandaCliente {
  provincia?: string;
  municipio?: string;
  cliente?: string;
  codigo?: string;
  geolocalizacion?: string;
  direccion_cliente?: string;
  canal?: string;
  validado?: boolean;
}

/** Trae una página de clientes de Parranda. Lanza si falta la API key o si responde !2xx. */
export async function fetchParrandaPage(offset: number): Promise<ParrandaCliente[]> {
  if (!PARRANDA_KEY) throw new Error('PARRANDA_API_KEY no configurado (.env)');
  const res = await fetch(PARRANDA_URL, {
    method: 'POST',
    headers: { 'X-Workflow-Api-Key': PARRANDA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ offset }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Parranda ${res.status} en offset ${offset}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { data?: ParrandaCliente[] };
  return Array.isArray(j.data) ? j.data : [];
}

// Extrae [lat, lng] de "20.030005, -75.82084".
function parseGeo(raw: unknown): { lat: number | null; lng: number | null } {
  if (typeof raw !== 'string') return { lat: null, lng: null };
  const m = raw.match(/-?\d{1,3}\.\d+/g);
  if (m && m.length >= 2) {
    const lat = parseFloat(m[0]);
    const lng = parseFloat(m[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
  }
  return { lat: null, lng: null };
}

export interface ParrandaSyncResult {
  paginas: number;
  total: number;
  creados: number;
  actualizados: number;
  conGeo: number;
  sinGeo: number;
  sinSucursal: number;
  errores: number;
}

/**
 * Sync completo: pagina Parranda, mapea provincia->sucursal, y upsert cada cliente
 * (match por nombre normalizado dentro de la sucursal, como el import del Consolidado).
 * Escribe geo (lat/lng/direccion/municipio/codigo). Al terminar avisa a delivery.
 */
export async function processParrandaSync(
  onProgress?: (p: ParrandaSyncResult) => void,
): Promise<ParrandaSyncResult> {
  // Mapa código-sucursal -> id.
  const sucursales = await prisma.sucursal.findMany({ select: { id: true, codigo: true } });
  const idByCode = new Map<string, string>();
  for (const s of sucursales) if (s.codigo) idByCode.set(s.codigo.toUpperCase(), s.id);

  // Precarga clientes existentes para matchear por nombre normalizado (rápido y preciso,
  // igual que el import del Consolidado). Clave: `${sucursalId}|${norm(nombre)}`.
  const existentes = await prisma.cliente.findMany({ select: { id: true, nombre: true, sucursalId: true } });
  const idByKey = new Map<string, string>();
  for (const c of existentes) if (c.sucursalId) idByKey.set(`${c.sucursalId}|${norm(c.nombre)}`, c.id);

  const r: ParrandaSyncResult = {
    paginas: 0, total: 0, creados: 0, actualizados: 0, conGeo: 0, sinGeo: 0, sinSucursal: 0, errores: 0,
  };

  let offset = 0;
  for (;;) {
    const data = await fetchParrandaPage(offset);
    if (!data.length) break;
    r.paginas++;

    for (const c of data) {
      r.total++;
      try {
        const code = PROV_TO_CODE[norm(c.provincia)];
        const sucursalId = code ? idByCode.get(code) ?? null : null;
        if (!sucursalId) { r.sinSucursal++; continue; }

        const nombre = String(c.cliente ?? '').toUpperCase().trim();
        if (!nombre) { r.errores++; continue; }

        const { lat, lng } = parseGeo(c.geolocalizacion);
        if (lat != null && lng != null) r.conGeo++; else r.sinGeo++;

        const geoData = {
          codigo: c.codigo ? String(c.codigo).trim() : null,
          direccion: c.direccion_cliente ? String(c.direccion_cliente).trim() : null,
          municipio: c.municipio ? String(c.municipio).trim() : null,
          latitud: lat,
          longitud: lng,
          geolocalizacion: typeof c.geolocalizacion === 'string' ? c.geolocalizacion : null,
        };

        const key = `${sucursalId}|${norm(nombre)}`;
        const existingId = idByKey.get(key);
        if (existingId) {
          await prisma.cliente.update({ where: { id: existingId }, data: geoData });
          r.actualizados++;
        } else {
          // Parranda SOLO enriquece a MIS clientes (los que vienen de los pedidos). Un cliente
          // de Parranda que NO existe aquí se OMITE: no se importa el catálogo entero de Parranda.
          r.creados = 0;
        }
      } catch {
        // P2002 (codigo/nombre duplicado) u otro: no tumbar el sync, contar y seguir.
        r.errores++;
      }
    }

    onProgress?.(r);
    offset += PAGE;
    if (data.length < PAGE) break; // última página
    await new Promise((res) => setTimeout(res, PAUSA_MS)); // pausa anti-ban
  }

  // Avisar a delivery: hay clientes nuevos/geolocalizados -> el mirror se re-sincroniza.
  if (r.creados > 0 || r.actualizados > 0) {
    try { await enqueueDeliveryOrders({ reason: 'parranda-clientes' }); } catch { /* best-effort */ }
  }
  return r;
}
