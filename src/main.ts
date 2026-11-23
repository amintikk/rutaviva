// Ruta viva: the live map of Spain's roads.
import '@fontsource-variable/inter';
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { WORKER_URL } from './map/worker.ts';
import { Protocol } from 'pmtiles';
import './styles/tokens.css';
import './styles/app.css';
import { ago, CATS, esc, FUELS, live, nf, price, V16_COLOR, type Cat, type FC } from './data.ts';
import { CLICKABLE, featureGroup, GROUPS, Layers, type Group } from './map/layers.ts';
import { baseStyle } from './map/style.ts';
import { initConsent, track } from './ui/consent.ts';
import * as D from './ui/details.ts';
import { icon, iconSvg } from './ui/icons.ts';
import { nearbyFuel } from './ui/nearby.ts';
import { Planner } from './ui/route.ts';
import { SearchBox, type Candidate, type Place } from './ui/search.ts';
import { Sheet } from './ui/sheet.ts';
import { isDark, readTheme, setTheme } from './ui/theme.ts';

maplibregl.setWorkerUrl(WORKER_URL);
const protocol = new Protocol({ metadata: true });
maplibregl.addProtocol('pmtiles', protocol.tile);

const params = new URLSearchParams(location.search);
const LS = 'rutaviva-layers';
const DEFAULT: Group[] = ['traffic', 'cameras', 'radars'];
function savedLayers(): Group[] {
  const q = params.get('capas');
  if (q) return q.split(',').filter((g): g is Group => GROUPS.some((x) => x.id === g));
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (Array.isArray(v)) return v.filter((g): g is Group => GROUPS.some((x) => x.id === g));
  } catch { /* first visit */ }
  return DEFAULT;
}
function saveLayers(list: Group[]): void {
  try { localStorage.setItem(LS, JSON.stringify(list)); } catch { /* storage blocked */ }
}

const app = document.getElementById('app')!;
let dark = isDark(readTheme());
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
let relief = true;
let terrain3d = false;

const mobile = matchMedia('(max-width: 720px)').matches;
const map = new maplibregl.Map({
  container: 'map',
  style: baseStyle(dark, relief),
  center: [-3.7, 40.1],
  zoom: mobile ? 4.6 : 5.6,
  minZoom: 4,
  maxZoom: 18.5,
  maxBounds: [[-22, 25], [8, 46.5]],
  hash: 'mapa',
  attributionControl: false,
  dragRotate: true,
  pitchWithRotate: true,
  maxPitch: 75,
  fadeDuration: 150,
});
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Datos: DGT, MITECO, REVE (Red Eléctrica), IGN, NASA FIRMS, Copernicus EFFIS · <a href="/fuentes/">Fuentes</a>' }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-right');
map.touchZoomRotate.enableRotation();

const layers = new Layers(map);
layers.dark = dark;
const sheet = new Sheet(app);
const active = new Set<Group>(savedLayers());

// ---------------------------------------------------------------- shell UI

const top = document.createElement('div');
top.className = 'topbar';
const card = document.createElement('div');
card.className = 'search-card glass';
const brand = document.createElement('a');
brand.className = 'brand';
brand.href = '/acerca/';
brand.setAttribute('aria-label', 'Ruta viva: acerca de');
brand.innerHTML = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0a84ff"/><path d="M10 25c4-6 2-9 6-13s7-3 7-3" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="23" cy="9" r="3.2" fill="#ffd60a"/><circle cx="10" cy="25" r="2.4" fill="#fff"/></svg>`;
const search = new SearchBox((p) => goTo(p));
search.local = (q) => roadSuggestions(q);
const routeBtn = document.createElement('button');
routeBtn.type = 'button';
routeBtn.className = 'icon-btn route-btn';
routeBtn.setAttribute('aria-label', 'Planificar un viaje');
routeBtn.title = 'Planificar un viaje';
routeBtn.append(icon('route', 20));
card.append(brand, search.el, routeBtn);

const chips = document.createElement('nav');
chips.className = 'chips-bar';
chips.setAttribute('aria-label', 'Capas del mapa');
for (const g of GROUPS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip-btn glass';
  b.dataset.group = g.id;
  b.style.setProperty('--c', g.color);
  b.title = g.hint;
  b.setAttribute('aria-pressed', String(active.has(g.id)));
  b.innerHTML = `${iconSvg(g.icon, 16)}<span>${g.label}</span>`;
  b.addEventListener('click', () => void toggle(g.id));
  chips.append(b);
}
// With a mouse, the wheel and a drag scroll the chip row sideways (touch screens already do).
chips.addEventListener('wheel', (e) => {
  if (chips.scrollWidth <= chips.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  chips.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
}, { passive: false });
let chipDrag: { x: number; left: number; moved: boolean } | null = null;
let chipDragged = false;
chips.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button === 0) chipDrag = { x: e.clientX, left: chips.scrollLeft, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!chipDrag) return;
  const dx = e.clientX - chipDrag.x;
  if (!chipDrag.moved && Math.abs(dx) > 5) { chipDrag.moved = true; chips.classList.add('dragging'); }
  if (chipDrag.moved) chips.scrollLeft = chipDrag.left - dx;
});
window.addEventListener('pointerup', () => {
  if (chipDrag?.moved) { chipDragged = true; window.setTimeout(() => { chipDragged = false; }, 0); }
  chipDrag = null;
  chips.classList.remove('dragging');
});
// A drag is not a click on the chip it ended on.
chips.addEventListener('click', (e) => { if (chipDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
const fuelSeg = document.createElement('div');
fuelSeg.className = 'seg fuel-seg glass';
fuelSeg.setAttribute('role', 'group');
fuelSeg.setAttribute('aria-label', 'Combustible');
for (const f of FUELS.slice(0, 5)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = f.short;
  b.title = f.label;
  b.dataset.fuel = f.code;
  b.setAttribute('aria-pressed', String(f.code === layers.fuel));
  b.addEventListener('click', () => {
    layers.setFuel(f.code);
    fuelSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    try { localStorage.setItem('rutaviva-fuel', f.code); } catch { /* ignore */ }
  });
  fuelSeg.append(b);
}
const nearBtn = document.createElement('button');
nearBtn.type = 'button';
nearBtn.className = 'near-btn';
nearBtn.title = 'Gasolineras abiertas cerca de ti, por precio o distancia';
nearBtn.append(icon('locate', 15), 'Cerca');
nearBtn.addEventListener('click', () => { pill.hidden = true; void nearbyFuel(ctx); track('fuel_nearby'); });
fuelSeg.append(nearBtn);
try {
  const f = localStorage.getItem('rutaviva-fuel');
  if (f && FUELS.some((x) => x.code === f)) {
    layers.fuel = f;
    fuelSeg.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.fuel === f)));
  }
} catch { /* ignore */ }
fuelSeg.hidden = !active.has('fuel');
// "See all" button: on a wide screen the row looks fixed, so it can unfold into a grid of every layer.
const chipsRow = document.createElement('div');
chipsRow.className = 'chips-row';
const moreBtn = document.createElement('button');
moreBtn.type = 'button';
moreBtn.className = 'chips-more glass';
moreBtn.append(icon('chevronDown', 18));
const moreCount = document.createElement('b');
moreBtn.append(moreCount);
chipsRow.append(chips, moreBtn);
const setChipsOpen = (open: boolean) => {
  chipsRow.classList.toggle('open', open);
  moreBtn.setAttribute('aria-expanded', String(open));
  const label = open ? 'Mostrar las capas en una fila' : 'Ver todas las capas';
  moreBtn.setAttribute('aria-label', label);
  moreBtn.title = label;
  if (!open) chips.scrollLeft = 0;
  try { localStorage.setItem('rutaviva-chips-open', open ? '1' : '0'); } catch { /* ignore */ }
  updateChipsMore();
};
// How many chips do not fit in the row (shown on the button while folded); no button if all fit.
function updateChipsMore(): void {
  const open = chipsRow.classList.contains('open');
  const box = chips.getBoundingClientRect();
  const hidden = open ? 0 : [...chips.children].filter((c) => c.getBoundingClientRect().right > box.right - 8).length;
  moreBtn.hidden = !open && hidden === 0;
  moreCount.textContent = hidden ? `+${hidden}` : '';
}
moreBtn.addEventListener('click', () => setChipsOpen(!chipsRow.classList.contains('open')));
chips.addEventListener('scroll', () => updateChipsMore(), { passive: true });
new ResizeObserver(() => updateChipsMore()).observe(chips);
let chipsOpen = false;
try { chipsOpen = localStorage.getItem('rutaviva-chips-open') === '1'; } catch { /* ignore */ }
setChipsOpen(chipsOpen);
top.append(card, chipsRow, fuelSeg);
// The detail sheet starts below the top bar, however tall the unfolded layers make it.
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${top.getBoundingClientRect().bottom}px`)).observe(top);
app.append(top);

const controls = document.createElement('div');
controls.className = 'controls';
const ctlBtn = (name: Parameters<typeof icon>[0], label: string, fn: () => void, cls = '') => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn glass ${cls}`;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(name, 19));
  b.addEventListener('click', fn);
  return b;
};
const zoomGroup = document.createElement('div');
zoomGroup.className = 'ctl-group glass';
zoomGroup.append(ctlBtn('plus', 'Acercar', () => map.zoomIn()), ctlBtn('minus', 'Alejar', () => map.zoomOut()));
const compass = ctlBtn('compass', 'Orientar al norte', () => map.easeTo({ bearing: 0, pitch: terrain3d ? 55 : 0, duration: 600 }), 'compass');
const btn3d = ctlBtn('mountain', 'Relieve en 3D', () => void set3d(!terrain3d));
const locate = ctlBtn('locate', 'Mi ubicación', () => locateMe());
const theme = ctlBtn(dark ? 'sun' : 'moon', 'Cambiar tema', () => switchTheme());
controls.append(zoomGroup, compass, btn3d, locate, theme);
app.append(controls);
map.on('rotate', () => { (compass.firstElementChild as SVGElement).style.transform = `rotate(${-map.getBearing() - 45}deg)`; });

// The always-available summary pill (when the sheet is closed).
const pill = document.createElement('button');
pill.type = 'button';
pill.className = 'now-pill glass';
pill.innerHTML = `<span class="live-dot"></span><span class="now-text">Cargando…</span>`;
pill.addEventListener('click', () => showSummary());
app.append(pill);


sheet.onClose = () => {
  layers.select(null);
  pill.hidden = false;
};

// ---------------------------------------------------------------- behaviour

const ctx: D.Ctx = {
  map, layers, sheet,
  open: (kind, props, lon, lat, push) => openDetail(kind, props, lon, lat, push),
  routeTo: (lon, lat, label) => planner.open({ label, short: label, lon, lat }),
};
const planner = new Planner(ctx);
routeBtn.addEventListener('click', () => { pill.hidden = true; planner.open(); track('route_open'); });

async function toggle(g: Group, on = !active.has(g)): Promise<void> {
  if (on) active.add(g);
  else active.delete(g);
  saveLayers([...active]);
  chips.querySelector(`[data-group="${g}"]`)?.setAttribute('aria-pressed', String(on));
  if (g === 'fuel') fuelSeg.hidden = !on;
  try {
    await layers.set(g, on);
  } catch {
    toast(`No se pudo cargar la capa ${GROUPS.find((x) => x.id === g)?.label}.`);
  }
  if (on) track('layer_on', { layer: g });
  if (g === 'ev') void refreshEvLive();
}

// Kinds that can be linked to (?ver=kind:id) and the source that holds them.
const SHARE_SOURCE: Partial<Record<D.Kind, string>> = {
  incident: 'incidents', camera: 'cameras', radar: 'radars', radarzone: 'radar-zones', alert: 'radar-alerts', mobile: 'radar-mobile',
  stretch: 'invive', motos: 'motos', fuel: 'fuel', ev: 'ev',
  vms: 'vms', zbe: 'zbe', quake: 'quakes', toll: 'tolls', fire: 'fires',
};

function openDetail(kind: D.Kind, props: Record<string, unknown>, lon: number, lat: number, push = false): void {
  pill.hidden = true;
  layers.select({ lon, lat });
  const id = props.id != null ? String(props.id) : '';
  // Radar sections share the id of their radar point.
  const shareKind = kind === 'radar' && props.kind === 'tramo' ? 'radar' : kind;
  sheet.pendingShare = SHARE_SOURCE[shareKind] && id ? { param: `${shareKind}:${id}`, title: String(props.name ?? props.brand ?? props.road ?? 'Ruta viva') } : null;
  const p = props as never;
  switch (kind) {
    case 'incident': D.incident(ctx, p, lon, lat); break;
    case 'congestion': D.congestion(ctx, p); break;
    case 'camera': D.camera(ctx, p, lon, lat, push); break;
    case 'radar': D.radar(ctx, p, lon, lat); break;
    case 'radarzone': D.radarZone(ctx, props); break;
    case 'alert': D.alert(ctx, p, lon, lat); break;
    case 'mobile': D.mobileZone(ctx, p, lon, lat); break;
    case 'stretch': D.stretch(ctx, props, 'stretch'); break;
    case 'motos': D.stretch(ctx, props, 'motos'); break;
    case 'fuel': D.fuel(ctx, p, lon, lat); break;
    case 'ev': D.charger(ctx, p, lon, lat); break;
    case 'evlive': D.chargerLive(ctx, p, lon, lat); break;
    case 'vms': D.vms(ctx, p); break;
    case 'zbe': D.zbe(ctx, p); break;
    case 'quake': D.quake(ctx, p); break;
    case 'toll': D.toll(ctx, props, lon, lat); break;
    case 'fire': D.fire(ctx, props, lon, lat); break;
  }
  sheet.pendingShare = null;
  track('detail', { kind });
}

const PRIORITY = ['inc-points', 'inc-dots', 'inc-dots-far', 'traffic-lines', 'traffic-dots', 'ev-live', 'cam-icon', 'alert-icon', 'alert-dot', 'vms-icon', 'radar-icon', 'fuel-label', 'fuel-dot', 'ev-icon', 'ev-dot', 'cam-dot', 'radar-dot', 'quake-dot', 'fire-icon', 'fire-dot', 'toll-booth', 'services-icon', 'radar-sections', 'motos', 'invive', 'radar-zones', 'motos-ends', 'invive-ends', 'radar-zones-ends', 'mobile-fill', 'toll-line', 'burnt-fill', 'zbe-fill'];
map.on('click', (e) => {
  const pad = mobile ? 12 : 6;
  const feats = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: CLICKABLE.filter((l) => map.getLayer(l)) });
  if (!feats.length) return;
  feats.sort((a, b) => PRIORITY.indexOf(a.layer.id) - PRIORITY.indexOf(b.layer.id));
  const f = feats[0] as MapGeoJSONFeature;
  const g = featureGroup(f);
  const props = { ...(f.properties as Record<string, unknown>) };
  const pt = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat] as [number, number];
  const kind: D.Kind | null = g === 'traffic' ? (f.source === 'traffic' ? 'congestion' : 'incident') : g === 'cameras' ? 'camera' : g === 'radars'
    ? (f.source === 'invive' ? 'stretch' : f.source === 'motos' ? 'motos' : f.source === 'radar-zones' ? 'radarzone' : 'radar')
    : g === 'mobile' ? (f.source === 'radar-alerts' ? 'alert' : 'mobile')
    : g === 'fuel' ? 'fuel' : g === 'ev' ? 'ev' : g === 'ev-live' ? 'evlive' : g === 'vms' ? 'vms' : g === 'zbe' ? 'zbe' : g === 'quakes' ? 'quake' : g === 'tolls' ? 'toll' : g === 'fires' ? 'fire' : null;
  if (kind === 'radar' && f.source === 'radar-sections') props.kind = 'tramo';
  if (kind) openDetail(kind, props, pt[0], pt[1]);
});
for (const l of CLICKABLE) {
  map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
}

// Live charger state (REVE) for the visible area when zoomed in.
let evTimer = 0;
async function refreshEvLive(): Promise<void> {
  window.clearTimeout(evTimer);
  if (!active.has('ev') || map.getZoom() < 13) return layers.setLive({ type: 'FeatureCollection', features: [] });
  const b = map.getBounds();
  const w = b.getWest();
  const e = b.getEast();
  const s = b.getSouth();
  const n = b.getNorth();
  if (e - w > 1.5 || n - s > 1.1) return;
  try {
    const r = await fetch(`/api/ev/markers?bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}&z=${Math.min(18, Math.round(map.getZoom()))}`);
    if (!r.ok) return;
    const list = (await r.json()) as { t: string; lon: number; lat: number; n: number; id?: string; name?: string; status?: string }[];
    layers.setLive({ type: 'FeatureCollection', features: list.filter((m) => m.t === 'l').map((m) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: { t: m.t, id: m.id, name: m.name, status: m.status, n: m.n } })) });
  } catch { /* the static layer still shows the chargers */ }
  evTimer = window.setTimeout(() => void refreshEvLive(), 90000);
}
map.on('moveend', () => void refreshEvLive());

// ---------------------------------------------------------------- summary

let summaryTimer = 0;
async function showSummary(fromBoot = false): Promise<void> {
  const stamp = sheet.stamp;
  const wasOpen = sheet.isOpen;
  const el = document.createElement('div');
  el.className = 'detail summary';
  const inc = layers.get('incidents') as FC | undefined;
  const feats = inc?.features ?? [];
  const counts = new Map<Cat, number>();
  for (const f of feats) counts.set((f.properties as { cat: Cat }).cat, (counts.get((f.properties as { cat: Cat }).cat) ?? 0) + 1);
  const cats = (Object.keys(CATS) as Cat[]).filter((c) => counts.get(c)).sort((a, b) => CATS[a].rank - CATS[b].rank);
  const grid = document.createElement('div');
  grid.className = 'cat-grid';
  for (const c of cats) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-tile';
    b.style.setProperty('--c', CATS[c].color);
    b.innerHTML = `${iconSvg(CATS[c].icon, 18)}<b>${nf.format(counts.get(c)!)}</b><span>${CATS[c].plural}</span>`;
    b.addEventListener('click', () => {
      const list = feats.filter((f) => (f.properties as { cat: Cat }).cat === c).sort((x, y) => String((y.properties as { start?: string }).start ?? '').localeCompare(String((x.properties as { start?: string }).start ?? '')));
      sheet.show(CATS[c].plural, `${nf.format(list.length)} ahora en España`, D.incidentList(ctx, list.slice(0, 200)), { push: true });
    });
    grid.append(b);
  }
  const v16 = feats.filter((f) => (f.properties as { v16?: number }).v16);
  if (v16.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-tile';
    b.style.setProperty('--c', V16_COLOR);
    b.innerHTML = `${iconSvg('siren', 18)}<b>${nf.format(v16.length)}</b><span>Balizas V16</span>`;
    b.addEventListener('click', () => {
      const list = [...v16].sort((x, y) => String((y.properties as { start?: string }).start ?? '').localeCompare(String((x.properties as { start?: string }).start ?? '')));
      sheet.show('Balizas V16 activadas', `${nf.format(list.length)} vehículos detenidos con la baliza encendida`, D.incidentList(ctx, list.slice(0, 200)), { push: true });
    });
    grid.append(b);
  }
  el.append(grid);
  const recent = feats.filter((f) => ((f.properties as { days?: number }).days ?? 0) < 1).length;
  const longrun = feats.filter((f) => ((f.properties as { days?: number }).days ?? 0) >= 7).length;
  const jam = (layers.get('traffic')?.features ?? []).filter((f) => ((f.properties as { state?: number }).state ?? 0) >= 3);
  const jamCity = (c: string) => jam.filter((f) => (f.properties as { city?: string }).city === c).length;
  const info = document.createElement('p');
  info.className = 'muted small';
  info.innerHTML = `<b>${nf.format(recent)}</b> avisos nuevos en las últimas 24 h · ${nf.format(longrun)} de larga duración (más de una semana, se ven atenuados).`;
  el.append(info);
  if (layers.get('traffic')) {
    const jams = document.createElement('p');
    jams.className = 'row now-jams';
    jams.innerHTML = `${iconSvg('gauge', 16)}<span>Ahora, tramos muy densos o con congestión: <b>${nf.format(jamCity('Madrid'))}</b> en Madrid y <b>${nf.format(jamCity('Barcelona'))}</b> en Barcelona.</span>`;
    el.append(jams);
  }
  const extras = document.createElement('div');
  extras.className = 'now-extras';
  const fuelFc = layers.get('fuel') as FC | undefined;
  const fuelPct = fuelFc?.pct;
  const meta = await live<{ feeds: Record<string, { updated?: string; count?: number }> }>('meta', 60).catch(() => null);
  // Something else was opened (or the sheet closed) while loading: do not cover it.
  if (sheet.stamp !== stamp || (fromBoot ? false : wasOpen !== sheet.isOpen)) return;
  const lines: string[] = [];
  if (fuelPct?.g95 && fuelPct.diesel) lines.push(`${iconSvg('fuel', 16)}<span>Precio mediano hoy: <b>${price(fuelPct.g95[2])}</b> gasolina 95 · <b>${price(fuelPct.diesel[2])}</b> diésel</span>`);
  if (meta?.feeds.vms?.count) lines.push(`${iconSvg('panel', 16)}<span><b>${nf.format(meta.feeds.vms.count)}</b> paneles con mensaje</span>`);
  if (meta?.feeds.cameras?.count) lines.push(`${iconSvg('video', 16)}<span><b>${nf.format(meta.feeds.cameras.count)}</b> cámaras en directo</span>`);
  if (meta?.feeds.ev?.count) lines.push(`${iconSvg('zap', 16)}<span><b>${nf.format(meta.feeds.ev.count)}</b> estaciones de recarga</span>`);
  extras.innerHTML = lines.map((l) => `<p class="row">${l}</p>`).join('');
  el.append(extras);
  const links = document.createElement('nav');
  links.className = 'explore';
  links.innerHTML = `<a href="/gasolineras/">${iconSvg('chart', 18)}<span><b>Gasolineras</b><small>Precios desde 2007, días baratos y marcas</small></span></a>
    <a href="/recarga/">${iconSvg('zap', 18)}<span><b>Recarga</b><small>Cargadores averiados por operador y precios</small></span></a>
    <a href="/zbe/">${iconSvg('leaf', 18)}<span><b>Zonas de bajas emisiones</b><small>Qué etiquetas entran en cada ciudad</small></span></a>
    <a href="/carreteras/">${iconSvg('road', 18)}<span><b>Carreteras</b><small>Estado, cámaras y radares de cada vía</small></span></a>`;
  el.append(links);
  const when = inc?.generated ? ago(inc.generated) : '';
  sheet.show('Ahora en las carreteras', feats.length ? `${nf.format(feats.length)} avisos activos${when ? ` · actualizado ${when}` : ''}` : 'Cargando…', el, { snap: fromBoot && mobile ? 'peek' : undefined });
  pill.hidden = true;
}

function updatePill(): void {
  const n = layers.get('incidents')?.features.length ?? 0;
  const acc = layers.get('incidents')?.features.filter((f) => (f.properties as { cat: string }).cat === 'accidente').length ?? 0;
  pill.querySelector('.now-text')!.innerHTML = `<b>${nf.format(n)}</b> avisos · <b>${nf.format(acc)}</b> accidentes`;
}

layers.onData = (name) => {
  if (name === 'incidents') {
    updatePill();
    window.clearTimeout(summaryTimer);
    // Refresh the summary in place if it is the view on screen.
    if (sheet.isOpen && sheet.depth === 1 && document.querySelector('.sheet .summary')) summaryTimer = window.setTimeout(() => void showSummary(), 50);
  }
};

// ---------------------------------------------------------------- search helpers

function roadSuggestions(q: string): Candidate[] {
  const norm = (s: string) => s.toUpperCase().replace(/[\s.]/g, '').replace(/^([A-Z]+)(\d)/, '$1-$2');
  const want = norm(q);
  if (!/^[A-Z]{1,4}-?\d/.test(want)) return [];
  const pts = new Map<string, [number, number][]>();
  for (const src of ['cameras', 'radars', 'incidents']) {
    for (const f of layers.features(src)) {
      const r = String((f.properties as { road?: string }).road ?? '').toUpperCase();
      if (!r || !r.startsWith(want)) continue;
      const list = pts.get(r) ?? [];
      list.push((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      pts.set(r, list);
    }
  }
  return [...pts.entries()].sort((a, b) => (a[0] === want ? -1 : b[0] === want ? 1 : a[0].length - b[0].length || b[1].length - a[1].length)).slice(0, 3).map(([road, list]) => {
    const xs = list.map((p) => p[0]);
    const ys = list.map((p) => p[1]);
    return { id: road, type: 'local', address: road, muni: `Carretera · ${list.length} puntos con datos`, lng: (Math.min(...xs) + Math.max(...xs)) / 2, lat: (Math.min(...ys) + Math.max(...ys)) / 2, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] } as Candidate;
  });
}

function goTo(p: Place): void {
  const pad = mobile ? { top: 140, bottom: 80, left: 30, right: 30 } : { top: 120, bottom: 60, left: sheet.isOpen ? 440 : 60, right: 80 };
  if (p.bbox) map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: pad, maxZoom: 15, duration: 1100 });
  else map.flyTo({ center: [p.lon, p.lat], zoom: 14, duration: 1100 });
  track('search');
}

function locateMe(): void {
  navigator.geolocation?.getCurrentPosition(
    (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13, duration: 1000 }),
    () => toast('No se pudo obtener tu ubicación.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function set3d(on: boolean): Promise<void> {
  terrain3d = on;
  btn3d.classList.toggle('on', on);
  btn3d.setAttribute('aria-pressed', String(on));
  if (on) {
    map.setTerrain({ source: 'terrain', exaggeration: 1.35 });
    map.easeTo({ pitch: 60, duration: 900 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 700 });
  }
}

function switchTheme(): void {
  dark = !dark;
  setTheme(dark ? 'dark' : 'light');
  layers.dark = dark;
  theme.replaceChildren(icon(dark ? 'sun' : 'moon', 19));
  map.setStyle(baseStyle(dark, relief), { diff: false });
  map.once('style.load', () => void reinstall());
}

async function reinstall(): Promise<void> {
  await layers.install();
  for (const g of active) await layers.set(g, true).catch(() => {});
  if (terrain3d) map.setTerrain({ source: 'terrain', exaggeration: 1.35 });
}

function toast(text: string): void {
  const t = document.createElement('div');
  t.className = 'toast glass';
  t.setAttribute('role', 'status');
  t.textContent = text;
  app.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
}

// ---------------------------------------------------------------- boot

map.on('load', async () => {
  // Start with the attribution folded behind its (i) button, like other map apps.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  await layers.install();
  await Promise.all([...active].map((g) => layers.set(g, true).catch(() => toast(`No se pudo cargar ${GROUPS.find((x) => x.id === g)?.label}.`))));
  // Incidents feed the summary even if the traffic layer is hidden.
  if (!active.has('traffic')) await layers.load('traffic').catch(() => {});
  // Roads for the search come from cameras and radars too.
  for (const g of ['cameras', 'radars'] as Group[]) if (!active.has(g)) void layers.load(g).catch(() => {});
  const road = params.get('carretera');
  if (road) {
    const c = roadSuggestions(road)[0];
    if (c?.bbox) goTo({ label: c.address, short: c.address, lon: c.lng, lat: c.lat, bbox: c.bbox });
  }
  if (params.get('ver')) void openShared(params.get('ver')!);
  else if (params.get('ruta') !== null) planner.open();
  else if (!location.hash.includes('mapa=') || !mobile) void showSummary(true);
  document.body.classList.add('ready');
});

/** Opens the item of a shared link (?ver=kind:id), turning its layer on. */
async function openShared(v: string): Promise<void> {
  const i = v.indexOf(':');
  const kind = v.slice(0, i) as D.Kind;
  const id = v.slice(i + 1);
  const source = SHARE_SOURCE[kind];
  const group = source ? GROUPS.find((g) => layers.sources(g.id).includes(source)) : undefined;
  if (!source || !group) return void showSummary(true);
  if (!active.has(group.id)) await toggle(group.id, true);
  const f = layers.features(source).find((x) => String((x.properties as { id?: unknown }).id) === id);
  if (!f) {
    toast('Ese elemento ya no está en el mapa: puede que el aviso haya terminado.');
    sheet.pendingShare = null;
    void showSummary(true);
    return;
  }
  const g = f.geometry;
  const coords: [number, number][] = g.type === 'Point' ? [g.coordinates as [number, number]]
    : g.type === 'LineString' || g.type === 'MultiPoint' ? (g.coordinates as [number, number][])
    : g.type === 'MultiLineString' || g.type === 'Polygon' ? (g.coordinates as [number, number][][]).flat()
    : g.type === 'MultiPolygon' ? (g.coordinates as [number, number][][][]).flat(2) : [];
  if (!coords.length) return;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const center: [number, number] = g.type === 'Point' ? coords[0]! : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  openDetail(kind, { ...(f.properties as Record<string, unknown>) }, center[0], center[1]);
  const pad = mobile ? { top: 120, bottom: window.innerHeight * 0.5, left: 30, right: 30 } : { top: 100, bottom: 60, left: 440, right: 80 };
  if (g.type === 'Point') map.jumpTo({ center, zoom: Math.max(map.getZoom(), 14) });
  else map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: 15, duration: 0 });
  track('shared_open', { kind });
}

// Fuel stations open or close with the clock.
window.setInterval(() => layers.refreshOpen(), 5 * 60000);

map.on('error', (e) => {
  if (String((e as unknown as { error?: { message?: string } }).error?.message ?? '').includes('pmtiles')) toast('El mapa base tarda en cargar. Reintentando…');
});

initConsent();
void esc;

// For automated visual checks only (?debug): exposes the map instance.
if (params.has('debug')) (window as unknown as { rv: unknown }).rv = { map, layers, open: openDetail };
