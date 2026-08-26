// Cliente de la API de Parranda (Retool) + sync de clientes hacia PEDIDO.
// Reemplaza el Consolidado_Geolocalizacion.xlsx: trae los clientes con geolocalización
// DIRECTA (lat,lng), paginado por `offset` (1000/página). El worker lo corre en segundo
// plano (secuencial, con pausa anti-ban), sin golpear la DB desde el request.
import prisma from '../prismaClient';
import { emitEvent } from './events';

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
/**
 * ¿Son la misma coordenada? Se comparan con margen porque son decimales y el
 * ultimo digito puede bailar entre lecturas sin que el punto haya cambiado. Sin
 * esto, ese baile bastaria para reescribir miles de filas en cada pasada.
 */
function mismoNumero(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  return Math.abs(a - b) < 0.0000001;
}

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
  /** Encontrados en Parranda pero SIN nada que cambiar. */
  sinCambios: number;
  conGeo: number;
  sinGeo: number;
  sinSucursal: number;
  errores: number;
  /** Los primeros motivos distintos, para poder arreglarlos. */
  erroresDetalle: string[];
  /** Códigos que ya tenía otro cliente de la misma sucursal. */
  choquesDeCodigo: number;
  /** Códigos con el prefijo de otra sucursal. */
  prefijosAjenos: number;
  /**
   * Lo que hay que enseñarle a Parranda, en cristiano y con nombres.
   *
   * Separado de `erroresDetalle`: un error es algo que se rompió aquí; esto es algo
   * que viene mal de fuera y que aquí se sorteó. Mezclarlos hace que se busque el
   * fallo en el sitio equivocado.
   */
  avisos: string[];
  /**
   * QUÉ cambió, cliente a cliente. Acotado: interesa mirar una muestra y entender qué
   * pasa, no guardar un diario entero en Redis.
   *
   * Sin esto, "198 cambiaron" no se puede ni creer ni desmentir. Y hace falta poder
   * desmentirlo: si son los MISMOS 198 en cada pasada, no es que cambien —es que algo
   * los está reescribiendo en círculo.
   */
  cambios: Array<{
    cliente: string;
    sucursal: string | null;
    campos: Array<{ campo: string; antes: string | null; despues: string | null }>;
  }>;
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
  // Se traen TAMBIEN los campos que este sync escribe, para poder comparar antes
  // de tocar nada. Antes solo se traia el id y se hacia un `update` a ciegas:
  // 6127 escrituras en cada pasada aunque no hubiera cambiado ni un dato.
  //
  // Y eso no era solo derroche. Cada `update` pisa `updatedAt`, que es la columna
  // que dice "cuando se sincronizo este cliente por ultima vez": si se toca a
  // todos, todos parecen recien actualizados y esa fecha deja de significar
  // nada. Ahora solo se escribe lo que de verdad cambio.
  const existentes = await prisma.cliente.findMany({
    select: {
      id: true, nombre: true, sucursalId: true,
      codigo: true, direccion: true, municipio: true,
      latitud: true, longitud: true, geolocalizacion: true,
    },
  });
  type Actual = (typeof existentes)[number];
  const porClave = new Map<string, Actual>();

  for (const c of existentes) if (c.sucursalId) porClave.set(`${c.sucursalId}|${norm(c.nombre)}`, c);

  // Quién tiene ya cada código, por sucursal.
  //
  // `(sucursalId, codigo)` es ÚNICO en la base, y Parranda manda a veces un código que
  // en esa misma sucursal ya lo lleva otro cliente. El update reventaba con "Unique
  // constraint failed" —121 de esos en una sola pasada—, no se escribía NADA de ese
  // cliente (ni la dirección, ni la geo) y en la siguiente pasada se volvía a
  // intentar. Para siempre.
  //
  // Con este mapa se ve venir el choque antes de escribir: se guarda todo lo demás y
  // se deja el código como está, en vez de perder la fila entera por un campo.
  const porCodigo = new Map<string, string>();
  const nombrePorId = new Map<string, string>();
  for (const c of existentes) {
    nombrePorId.set(c.id, c.nombre);
    if (c.sucursalId && c.codigo) porCodigo.set(`${c.sucursalId}|${c.codigo}`, c.id);
  }

  // Qué prefijo usa DE VERDAD cada sucursal.
  //
  // Los códigos de Parranda empiezan por dos letras que identifican la sucursal, pero
  // con un esquema distinto del nuestro: SC es Santiago, LT es Las Tunas, CM Camagüey,
  // SS Sancti Spíritus… No hay tabla en ninguna parte, así que en vez de inventarme una
  // —y equivocarme el día que aparezca una sucursal nueva— se mira lo que ya hay: el
  // prefijo que lleva la mayoría de los clientes de esa sucursal es el suyo.
  //
  // Sirve para señalar los códigos que vienen con el prefijo de OTRA sucursal, que es
  // lo que hay que enseñarle a Parranda.
  const cuentaPrefijos = new Map<string, Map<string, number>>();
  for (const c of existentes) {
    if (!c.sucursalId || !c.codigo || c.codigo.length < 2) continue;
    const pre = c.codigo.slice(0, 2).toUpperCase();
    if (!cuentaPrefijos.has(c.sucursalId)) cuentaPrefijos.set(c.sucursalId, new Map());
    const m = cuentaPrefijos.get(c.sucursalId)!;
    m.set(pre, (m.get(pre) ?? 0) + 1);
  }
  const prefijoDe = new Map<string, string>();
  for (const [sid, m] of cuentaPrefijos) {
    const [mejor] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (mejor && mejor[1] >= 5) prefijoDe.set(sid, mejor[0]);
  }

  const r: ParrandaSyncResult = {
    paginas: 0, total: 0, creados: 0, actualizados: 0, sinCambios: 0, conGeo: 0, sinGeo: 0, sinSucursal: 0, errores: 0,
    erroresDetalle: [], cambios: [], choquesDeCodigo: 0, prefijosAjenos: 0, avisos: [],
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
        const actual = porClave.get(key);

        if (actual) {
          // Solo se escribe si algo CAMBIO de verdad. Las coordenadas se comparan
          // con margen: son decimales y una diferencia en el ultimo digito no es
          // un cambio real, pero bastaria para escribir las 6127 filas otra vez.
          // Qué campos cambian, uno a uno, en vez de un sí/no. Es lo que hay que
          // poder MIRAR: "198 cambiaron" no se puede ni creer ni desmentir, y "198
          // cambiaron el municipio de Camagüey a CAMAGÜEY" se arregla en cinco
          // minutos.
          const campos: Array<{ campo: string; antes: string | null; despues: string | null }> = [];
          const anota = (campo: string, antes: unknown, despues: unknown) => {
            campos.push({
              campo,
              antes: antes == null ? null : String(antes),
              despues: despues == null ? null : String(despues),
            });
          };

          if ((geoData.codigo ?? null) !== (actual.codigo ?? null)) anota('código', actual.codigo, geoData.codigo);
          if ((geoData.direccion ?? null) !== (actual.direccion ?? null)) anota('dirección', actual.direccion, geoData.direccion);
          if ((geoData.municipio ?? null) !== (actual.municipio ?? null)) anota('municipio', actual.municipio, geoData.municipio);
          if ((geoData.geolocalizacion ?? null) !== (actual.geolocalizacion ?? null)) anota('geolocalización', actual.geolocalizacion, geoData.geolocalizacion);
          if (!mismoNumero(geoData.latitud, actual.latitud)) anota('latitud', actual.latitud, geoData.latitud);
          if (!mismoNumero(geoData.longitud, actual.longitud)) anota('longitud', actual.longitud, geoData.longitud);

          // ¿El código que viene lo tiene ya otro cliente de esta sucursal?
          const dueñoDelCodigo = geoData.codigo
            ? porCodigo.get(`${sucursalId}|${geoData.codigo}`)
            : undefined;
          const codigoOcupado = dueñoDelCodigo != null && dueñoDelCodigo !== actual.id;

          // ¿Viene con el prefijo de otra sucursal? Se anota y se sigue: el dato es
          // válido igualmente, pero es la prueba de que en el origen están asignando
          // códigos que no corresponden.
          const preEsperado = prefijoDe.get(sucursalId);
          const preRecibido = geoData.codigo?.slice(0, 2).toUpperCase();
          if (preEsperado && preRecibido && preEsperado !== preRecibido) {
            r.prefijosAjenos++;
            if (r.avisos.length < 30) {
              r.avisos.push(
                `${nombre} (${code}): el código ${geoData.codigo} empieza por ${preRecibido}, ` +
                  `y en ${code} todos los demás empiezan por ${preEsperado}`,
              );
            }
          }

          if (codigoOcupado) {
            // Se escribe todo menos el código, y se deja dicho quién lo tiene: eso es
            // lo que hay que arreglar en el origen, y sin el nombre del otro cliente
            // no hay por dónde empezar.
            geoData.codigo = actual.codigo ?? null;
            const i = campos.findIndex((f) => f.campo === 'código');
            if (i >= 0) campos.splice(i, 1);

            r.choquesDeCodigo++;
            if (r.avisos.length < 30) {
              const otro = nombrePorId.get(dueñoDelCodigo!) ?? 'otro cliente';
              r.avisos.push(
                `${nombre} (${code}): Parranda le manda el código ${String(c.codigo).trim()}, ` +
                  `que en esa misma sucursal ya lo tiene ${otro}. Se guardó el resto sin tocar su código.`,
              );
            }
          }

          const cambio = campos.length > 0;

          if (cambio) {
            if (r.cambios.length < 200) {
              r.cambios.push({ cliente: nombre, sucursal: code ?? null, campos });
            }
            await prisma.cliente.update({ where: { id: actual.id }, data: geoData });
            r.actualizados++;

            // Y la foto se actualiza con lo que se acaba de escribir.
            //
            // Sin esto, el mismo cliente repetido en el origen se comparaba SIEMPRE
            // contra el valor que tenía antes de empezar: la segunda aparición veía
            // una diferencia que ya se había escrito y volvía a escribir. Parranda
            // manda 12.049 filas para 8.850 clientes, o sea que repetir es lo normal,
            // no la excepción.
            //
            // Y no era solo contar de más: gana la última aparición, así que si el
            // orden cambia entre pasadas el valor guardado va y viene, y en la
            // siguiente "cambia" otra vez. Eso es lo que hacía que el número subiera
            // solo —5703, 5913, 6127, 6602— sin que nadie tocara nada.
            porClave.set(key, { ...actual, ...geoData });
            // El código recién escrito pasa a estar ocupado por este cliente: si más
            // abajo llega otro con el mismo, se ve el choque igual que si viniera de
            // la base.
            if (geoData.codigo) porCodigo.set(`${sucursalId}|${geoData.codigo}`, actual.id);
          } else {
            r.sinCambios++;
          }
        } else {
          // Parranda SOLO enriquece a MIS clientes (los que vienen de los pedidos). Un cliente
          // de Parranda que NO existe aquí se OMITE: no se importa el catálogo entero de Parranda.
          r.creados = 0;
        }
      } catch (e) {
        // P2002 (codigo/nombre duplicado) u otro: no tumbar el sync, contar y seguir.
        //
        // Pero se guardan los primeros motivos. "114 err" a secas no se puede
        // arreglar: no dice si son 114 veces lo mismo o 114 cosas distintas, y sin
        // eso nadie sabe por dónde empezar.
        r.errores++;
        if (r.erroresDetalle.length < 5) {
          const msg = (e as Error)?.message ?? String(e);
          if (!r.erroresDetalle.includes(msg)) r.erroresDetalle.push(msg);
        }
      }
    }

    onProgress?.(r);
    offset += PAGE;
    if (data.length < PAGE) break; // última página
    await new Promise((res) => setTimeout(res, PAUSA_MS)); // pausa anti-ban
  }

  // Avisar a delivery: hay clientes nuevos/geolocalizados -> el mirror se re-sincroniza.
  if (r.creados > 0 || r.actualizados > 0) {
    // Y avisar al front por SSE: el sync corre en el worker, así que sin este evento la
    // lista de clientes se queda con los datos viejos hasta que alguien recargue.
    emitEvent('cliente', { accion: 'sync-parranda' });
  }
  return r;
}
