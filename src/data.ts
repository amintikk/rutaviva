// Live layers written by the worker (/live/*.json) and the labels used to describe them.
import type { IconName } from './ui/icons.ts';

export type FC<P = Record<string, unknown>> = GeoJSON.FeatureCollection<GeoJSON.Geometry, P> & {
  generated?: string; source_time?: string; pct?: Record<string, number[]>; errors?: string[];
};

export interface Incident {
  id: string; src: 'dgt' | 'sct' | 'gv'; cat: Cat; road?: string; km?: number; km2?: number; dir?: string; prov?: string;
  muni?: string; start?: string; end?: string; sev?: string; what?: string; txt?: string;
}
export interface Camera { id: string; road: string; km?: number; prov?: string; dest?: string }
export interface Radar { id: string; kind: 'fijo' | 'tramo'; road: string; km?: number; km2?: number; len?: number; prov?: string; dir?: string }
export interface Panel { id: string; road: string; km?: number; prov?: string; dest?: string; lines: string; picts: string; set?: string; on: boolean }
export interface Station {
  id: string; brand: string; addr: string; muni: string; prov: string; cp: string; hours: string; side: string; public: boolean;
  [price: `p_${string}`]: number | undefined;
}
export interface Charger { id: string; name: string; op: string; addr: string; muni: string; prov: string; hours: string; points: number; kw: number; conns: string; dc: boolean }
export interface Zone { id: string; city: string; name: string; url: string; status: string; since: string; banned: string; listed: string; periods: string }
export interface Quake { id: string; mag?: number; when: string; place: string; url: string }

export type Cat = 'accidente' | 'cerrada' | 'retencion' | 'nieve' | 'meteo' | 'obstaculo' | 'obras' | 'evento' | 'otro';

export const CATS: Record<Cat, { label: string; plural: string; color: string; icon: IconName; rank: number }> = {
  accidente: { label: 'Accidente', plural: 'Accidentes', color: '#ff3b30', icon: 'car', rank: 0 },
  cerrada: { label: 'Corte de carretera', plural: 'Cortes', color: '#c7102e', icon: 'closed', rank: 1 },
  nieve: { label: 'Nieve o hielo', plural: 'Nieve y hielo', color: '#0a84ff', icon: 'snow', rank: 2 },
  retencion: { label: 'Retención', plural: 'Retenciones', color: '#ff9f0a', icon: 'gauge', rank: 3 },
  meteo: { label: 'Meteorología adversa', plural: 'Meteorología', color: '#30b0c7', icon: 'rain', rank: 4 },
  obstaculo: { label: 'Obstáculo o vehículo detenido', plural: 'Obstáculos', color: '#e8a400', icon: 'alert', rank: 5 },
  obras: { label: 'Obras', plural: 'Obras', color: '#f08a24', icon: 'works', rank: 6 },
  evento: { label: 'Evento o prueba deportiva', plural: 'Eventos', color: '#af52de', icon: 'flag', rank: 7 },
  otro: { label: 'Aviso', plural: 'Otros avisos', color: '#8e8e93', icon: 'info', rank: 8 },
};

export const SRC: Record<string, string> = { dgt: 'DGT', sct: 'Servei Català de Trànsit', gv: 'Tráfico del Gobierno Vasco' };

// DATEX II enum values kept by the worker, in plain Spanish.
export const WHAT: Record<string, string> = {
  roadClosed: 'Carretera cortada', carriagewayClosures: 'Calzada cortada', laneClosures: 'Carriles cortados',
  singleAlternateLineTraffic: 'Paso alternativo', narrowLanes: 'Carriles estrechados', lanesDeviated: 'Carriles desviados',
  newRoadworksLayout: 'Nuevo trazado por obras', contraflow: 'Circulación en sentido contrario',
  useOfSpecifiedLanesOrCarriagewaysAllowed: 'Uso de carriles especiales', roadworks: 'Obras', accident: 'Accidente',
  slowTraffic: 'Tráfico lento', stationaryTraffic: 'Tráfico detenido', queuingTraffic: 'Retención', heavyTraffic: 'Tráfico denso',
  rain: 'Lluvia', snowfall: 'Nevada', heavySnowfall: 'Nevada intensa', snowDrifts: 'Ventisca', ice: 'Hielo', blackIce: 'Placas de hielo',
  freezingRain: 'Lluvia helada', fog: 'Niebla', denseFog: 'Niebla densa', strongWinds: 'Viento fuerte', flooding: 'Inundación',
  objectOnTheRoad: 'Objeto en la calzada', obstructionOnTheRoad: 'Obstáculo en la calzada', animalsOnTheRoad: 'Animales en la vía',
  brokenDownVehicle: 'Vehículo averiado', vehicleOnFire: 'Vehículo en llamas', slipperyRoad: 'Calzada deslizante',
  roadSurfaceInPoorCondition: 'Firme en mal estado', snowChainsMandatory: 'Cadenas obligatorias',
  snowTyresMandatory: 'Neumáticos de invierno obligatorios', snowChainsOrTyresMandatory: 'Cadenas o neumáticos de invierno',
  winterEquipmentMandatory: 'Equipamiento de invierno obligatorio', heavyVehicle: 'Afecta a camiones', carOrLightVehicle: 'Afecta a turismos',
  motorcycle: 'Afecta a motos', anyVehicle: 'Todos los vehículos', mandatory: 'Obligatorio', advisory: 'Recomendación',
  bothWays: 'Ambos sentidos', positive: 'Sentido creciente', negative: 'Sentido decreciente',
  allLanesCompleteCarriageway: 'Todos los carriles', hardShoulder: 'Arcén', leftLane: 'Carril izquierdo', rightLane: 'Carril derecho',
  centralLane: 'Carril central', roadClearance: 'Limpieza de calzada', roadMarkingWork: 'Pintado de marcas viales',
  resurfacingWork: 'Reasfaltado', maintenanceWork: 'Mantenimiento', sportsEvent: 'Prueba deportiva', march: 'Marcha',
  procession: 'Procesión', emergencyVehicles: 'Vehículos de emergencia', landslips: 'Desprendimientos', rockfalls: 'Caída de piedras',
  fire: 'Incendio', smokeHazard: 'Humo', crosswinds: 'Viento lateral', visibilityReduced: 'Visibilidad reducida',
  hazardsOnTheRoad: 'Peligro en la vía', spillageOnTheRoad: 'Vertido en la calzada', temporaryTrafficLights: 'Semáforo provisional',
  trafficControl: 'Regulación del tráfico', trafficHeld: 'Tráfico retenido por agentes', convoyService: 'Paso en caravana',
  rollingRoadBlock: 'Corte intermitente',
};

export const FUELS: { code: string; label: string; short: string }[] = [
  { code: 'g95', label: 'Gasolina 95', short: '95' },
  { code: 'diesel', label: 'Diésel', short: 'Diésel' },
  { code: 'g98', label: 'Gasolina 98', short: '98' },
  { code: 'glp', label: 'GLP (autogás)', short: 'GLP' },
  { code: 'dieselp', label: 'Diésel premium', short: 'Diésel+' },
  { code: 'gnc', label: 'Gas natural (GNC)', short: 'GNC' },
  { code: 'h2', label: 'Hidrógeno', short: 'H₂' },
  { code: 'adblue', label: 'AdBlue', short: 'AdBlue' },
];
export const FUEL_LABEL: Record<string, string> = {
  ...Object.fromEntries(FUELS.map((f) => [f.code, f.label])),
  g95e10: 'Gasolina 95 E10', g95p: 'Gasolina 95 premium', g98e10: 'Gasolina 98 E10', dieselb: 'Gasóleo B (agrícola)',
  gnl: 'Gas natural licuado (GNL)', hvo: 'Diésel renovable (HVO)', grenov: 'Gasolina renovable', e85: 'Bioetanol E85', biodiesel: 'Biodiésel',
};

const cache = new Map<string, { at: number; data: unknown }>();

/** Fetch a live layer; `maxAge` seconds of in-memory reuse between panels. */
export async function live<T = FC>(name: string, maxAge = 60): Promise<T> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < maxAge * 1000) return hit.data as T;
  const r = await fetch(`/live/${name}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const data = (await r.json()) as T;
  cache.set(name, { at: Date.now(), data });
  return data;
}

export const nf = new Intl.NumberFormat('es-ES');
export const price = (v: number | undefined, digits = 3) => (v == null ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`);

export function km(v: number | undefined | null): string {
  if (v == null) return '';
  return `km ${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })}`;
}

export function ago(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 45) return `hace ${d} días`;
  const mo = Math.round(d / 30.4);
  if (mo < 18) return `hace ${mo} meses`;
  return `hace ${Math.round(d / 365)} años`;
}

export function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function titleCase(s: string | undefined): string {
  if (!s) return '';
  // "CORUÑA, A" / "Palmas (las)" -> "A Coruña" / "Las Palmas"
  const inv = /^(.*?),\s*(A|O|La|Las|Los|El|L'|Els|Les|Illes)$/i.exec(s.trim()) ?? /^(.*?)\s*\((a|o|la|las|los|el|illes)\)$/i.exec(s.trim());
  if (inv) s = `${inv[2]} ${inv[1]}`;
  if (s !== s.toUpperCase()) return s.charAt(0).toUpperCase() + s.slice(1);
  const t = s.toLowerCase().replace(/(^|[\s(/'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y|A|En)\b/g, (w) => w.toLowerCase());
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
