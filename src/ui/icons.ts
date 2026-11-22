// Every icon comes from Lucide (https://lucide.dev, ISC licence): DOM nodes for the interface,
// SVG strings for the static pages and canvas-rendered images for the map markers.
import {
  Activity, ArrowUpDown, BatteryCharging, Ban, Box, Calendar, Camera, CarFront, ChartLine, ChevronDown, ChevronLeft, ChevronRight,
  CircleDot, Clock, CloudRain, Compass, Construction, Euro, ExternalLink, Flag, Fuel, Gauge, Info, Layers, Leaf, LoaderCircle,
  LocateFixed, MapPin, Menu, Minus, Moon, Mountain, Navigation, OctagonX, Plus, PlugZap, Radar, RectangleHorizontal, RefreshCw,
  Route, Search, Share2, ShieldAlert, Signpost, Snowflake, Sun, TrafficCone, TrendingDown, TrendingUp, TriangleAlert, Video, Waypoints,
  X, Zap, Bike, type IconNode,
} from 'lucide';

export const ICONS = {
  activity: Activity, swap: ArrowUpDown, battery: BatteryCharging, ban: Ban, box: Box, calendar: Calendar, camera: Camera,
  car: CarFront, chart: ChartLine, chevronDown: ChevronDown, chevronLeft: ChevronLeft, chevronRight: ChevronRight, dot: CircleDot,
  clock: Clock, rain: CloudRain, compass: Compass, works: Construction, euro: Euro, external: ExternalLink, flag: Flag, fuel: Fuel,
  gauge: Gauge, info: Info, layers: Layers, leaf: Leaf, loader: LoaderCircle, locate: LocateFixed, pin: MapPin, menu: Menu,
  minus: Minus, moon: Moon, mountain: Mountain, navigation: Navigation, closed: OctagonX, plus: Plus, plug: PlugZap, radar: Radar,
  panel: RectangleHorizontal, refresh: RefreshCw, route: Route, search: Search, share: Share2, shield: ShieldAlert, road: Signpost,
  snow: Snowflake, sun: Sun, cone: TrafficCone, down: TrendingDown, up: TrendingUp, alert: TriangleAlert, video: Video,
  waypoints: Waypoints, x: X, zap: Zap, bike: Bike,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

function attrString(a: Record<string, string | number | undefined>): string {
  return Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${String(v)}"`).join(' ');
}

/** SVG markup of an icon (stroke = currentColor unless a colour is given). */
export function iconSvg(name: IconName, size = 20, color = 'currentColor', stroke = 1.9): string {
  const inner = (ICONS[name] as IconNode).map(([tag, a]) => `<${tag} ${attrString(a as Record<string, string>)}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** The icon as a DOM node. */
export function icon(name: IconName, size = 20, cls = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = iconSvg(name, size);
  const el = tpl.content.firstElementChild as SVGSVGElement;
  if (cls) el.classList.add(cls);
  return el;
}

/** A round map marker: coloured disc, white ring and white glyph, rendered at device pixel ratio. */
export async function markerImage(name: IconName, color: string, size = 30, ratio = 2, ring = '#ffffff'): Promise<ImageData> {
  const px = Math.round(size * ratio);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const r = px / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 3 * ratio;
  ctx.shadowOffsetY = 1 * ratio;
  ctx.beginPath();
  ctx.arc(r, r, r - 2.5 * ratio, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(r, r, r - 4.2 * ratio, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  const img = new Image();
  const glyph = Math.round(px * 0.5);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, glyph, '#ffffff', 2.4))}`;
  await img.decode();
  ctx.drawImage(img, r - glyph / 2, r - glyph / 2, glyph, glyph);
  return ctx.getImageData(0, 0, px, px);
}

/** A rounded-square marker (cameras, panels), to tell devices from events at a glance. */
export async function squareImage(name: IconName, color: string, size = 26, ratio = 2): Promise<ImageData> {
  const px = Math.round(size * ratio);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
  };
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 3 * ratio;
  ctx.shadowOffsetY = 1 * ratio;
  rr(2 * ratio, 2 * ratio, px - 4 * ratio, px - 4 * ratio, 8 * ratio);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  rr(3.6 * ratio, 3.6 * ratio, px - 7.2 * ratio, px - 7.2 * ratio, 6.5 * ratio);
  ctx.fillStyle = color;
  ctx.fill();
  const img = new Image();
  const glyph = Math.round(px * 0.52);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, glyph, '#ffffff', 2.3))}`;
  await img.decode();
  ctx.drawImage(img, (px - glyph) / 2, (px - glyph) / 2, glyph, glyph);
  return ctx.getImageData(0, 0, px, px);
}
