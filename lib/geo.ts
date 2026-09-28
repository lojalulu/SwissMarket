// lib/geo.ts — distância de carro a partir de casa (Bern) e desvio no caminho para o trabalho (Interlaken).
//
// Coordenadas dos códigos postais: GeoNames (CC BY 4.0, https://www.geonames.org), em config/ch-plz.json.
// Tempo de carro:
//   1. estimativa offline (sempre disponível): minutos ≈ 9.2 + 0.764 × km em linha reta.
//      Calibrada com 27 trajetos reais a partir de Bern (erro típico ±5 min; zonas de montanha podem
//      dar até −13 min, por isso o painel diz "estimativa").
//   2. tempo real de estrada via OSRM (router.project-osrm.org), pedido 1× por código postal e guardado
//      em cache na VPS. Desligue com DRIVE_TIMES=estimate.
import plzData from '../config/ch-plz.json';
import { normalize } from './text';

export type LatLon = { lat: number; lon: number };

const PLZ = plzData as unknown as Record<string, [number, number, string]>;

const env = (k: string) => (typeof process !== 'undefined' ? (process.env?.[k] ?? '').trim() : '');
const num = (k: string, d: number) => { const v = Number(env(k)); return Number.isFinite(v) && env(k) !== '' ? v : d; };

/** Casa (padrão: centro de Bern) e trabalho (padrão: Interlaken). Configurável na VPS. */
export function homePoint(): LatLon { return { lat: num('HOME_LAT', 46.948), lon: num('HOME_LON', 7.4474) }; }
export function workPoint(): LatLon | null {
  if (env('WORK_LAT') === 'off') return null;
  return { lat: num('WORK_LAT', 46.6863), lon: num('WORK_LON', 7.8632) };
}
export const maxDriveMin = () => num('MAX_DRIVE_MIN', 40);
/** Custo por km de carro (combustível + desgaste), ida e volta. */
export const travelChfPerKm = () => num('TRAVEL_CHF_PER_KM', 0.25);

export function plzInfo(zip: string | null | undefined): { zip: string; place: string; point: LatLon } | null {
  if (!zip) return null;
  const z = String(zip).trim().slice(0, 4);
  const e = PLZ[z];
  return e ? { zip: z, place: e[2].split('|')[0], point: { lat: e[0], lon: e[1] } } : null;
}

let byName: Map<string, string> | null = null;
/** "Thun" / "3600" / "3600 Thun" / "Biel/Bienne" → código postal. */
export function findZip(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b([1-9]\d{3})\b/);
  if (m && PLZ[m[1]]) return m[1];
  if (!byName) {
    byName = new Map();
    for (const [z, e] of Object.entries(PLZ)) {
      for (const name of e[2].split('|')) {
        const n = normalize(name);
        if (n && !byName.has(n)) byName.set(n, z);
        const first = normalize(name.split(/[\/(,]/)[0]);
        if (first && !byName.has(first)) byName.set(first, z);
      }
    }
  }
  const n = normalize(text);
  if (byName.has(n)) return byName.get(n)!;
  // "Bern Bümpliz" → tenta palavras da frente para trás
  const words = n.split(' ');
  for (let len = words.length - 1; len >= 1; len--) {
    const k = words.slice(0, len).join(' ');
    if (byName.has(k)) return byName.get(k)!;
  }
  return null;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371, rad = Math.PI / 180;
  const dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimativa offline (minutos de carro). Mesmo local → 5 min (estacionar, procurar a morada). */
export function estimateDriveMin(a: LatLon, b: LatLon): number {
  const km = haversineKm(a, b);
  return km < 1.5 ? 5 : Math.round(9.2 + 0.764 * km);
}
/** km de estrada ≈ 1,25 × linha reta. */
export const roadKm = (a: LatLon, b: LatLon) => Math.round(haversineKm(a, b) * 1.25 * 10) / 10;

export interface DriveInfo {
  zip: string;
  place: string;
  /** Minutos de carro casa → local. */
  minutes: number;
  /** km de estrada casa → local. */
  km: number;
  /** Minutos a mais se for no caminho casa → trabalho (null = sem trabalho configurado). */
  detourMin: number | null;
  /** km a mais nesse desvio. */
  detourKm: number | null;
  via: 'osrm' | 'estimate';
}

/** Distância (km) de um ponto a um segmento, numa projeção local plana (suficiente à escala da Suíça). */
function distToSegmentKm(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), ky = 110.57;
  const ax = a.lon * kx, ay = a.lat * ky, bx = b.lon * kx, by = b.lat * ky, px = p.lon * kx, py = p.lat * ky;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Percurso casa → trabalho. Com os valores padrão segue a A6/A8 (Bern → Thun → Spiez → Interlaken). */
function commuteCorridor(home: LatLon, work: LatLon): LatLon[] {
  const defaults = !env('HOME_LAT') && !env('WORK_LAT');
  return defaults
    ? [home, { lat: 46.8878, lon: 7.5249 }, { lat: 46.7686, lon: 7.6089 }, { lat: 46.6912, lon: 7.6694 }, { lat: 46.6934, lon: 7.7897 }, work]
    : [home, work];
}

export function estimateDrive(zip: string): DriveInfo | null {
  const info = plzInfo(zip);
  if (!info) return null;
  const home = homePoint(), work = workPoint(), x = info.point;
  const minutes = estimateDriveMin(home, x);
  const km = roadKm(home, x);
  let detourMin: number | null = null, detourKm: number | null = null;
  if (work) {
    // Desvio = sair do caminho, ir e voltar: 2 × distância ao percurso × 1,3 (estradas), a ~60 km/h,
    // + 5 min para sair da autoestrada/estacionar. Prudente de propósito (o OSRM, se ativo, corrige).
    const c = commuteCorridor(home, work);
    let d = Infinity;
    for (let i = 0; i < c.length - 1; i++) d = Math.min(d, distToSegmentKm(x, c[i], c[i + 1]));
    detourKm = Math.round(2 * d * 1.3 * 10) / 10;
    detourMin = Math.round(5 + detourKm);
  }
  return { zip: info.zip, place: info.place, minutes, km, detourMin, detourKm, via: 'estimate' };
}

/** Tempo real via OSRM (1 pedido: casa→X e X→trabalho). Devolve null se falhar. */
export async function osrmDrive(zip: string, timeoutMs = 6000): Promise<DriveInfo | null> {
  const info = plzInfo(zip);
  if (!info || env('DRIVE_TIMES') === 'estimate') return null;
  const home = homePoint(), work = workPoint(), x = info.point;
  const pts = [home, x, ...(work ? [work] : [])].map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${env('OSRM_URL') || 'https://router.project-osrm.org'}/table/v1/driving/${pts}?annotations=duration,distance`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SwissMarket/1.0 (personal use)' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json() as { code: string; durations: number[][]; distances: number[][] };
    if (j.code !== 'Ok') return null;
    const d = j.durations, k = j.distances;
    const minutes = Math.round(d[0][1] / 60);
    const km = Math.round(k[0][1] / 100) / 10;
    let detourMin: number | null = null, detourKm: number | null = null;
    if (work) {
      detourMin = Math.max(0, Math.round((d[0][1] + d[1][2] - d[0][2]) / 60));
      detourKm = Math.max(0, Math.round((k[0][1] + k[1][2] - k[0][2]) / 100) / 10);
    }
    return { zip: info.zip, place: info.place, minutes, km, detourMin, detourKm, via: 'osrm' };
  } catch {
    return null;
  }
}

/**
 * Custo real da viagem para ir buscar (ida e volta, CHF): o menor entre ir de propósito a partir
 * de casa e fazer o desvio no caminho do trabalho.
 */
export function travelCost(d: DriveInfo): { chf: number; mode: 'caminho' | 'ida' } {
  const perKm = travelChfPerKm();
  const trip = Math.round(d.km * 2 * perKm);
  if (d.detourKm !== null && d.detourMin !== null && d.detourMin <= 15) {
    const detour = Math.round(d.detourKm * perKm);
    if (detour < trip) return { chf: detour, mode: 'caminho' };
  }
  return { chf: trip, mode: 'ida' };
}
