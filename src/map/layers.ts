// Data layers on top of the base map: sources, styling, visibility and periodic refresh.
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl';
import { CATS, live, V16_COLOR, type Cat, type FC } from '../data.ts';
import { openState } from '../ui/hours.ts';
import { markerImage, radarImage, squareImage, type IconName } from '../ui/icons.ts';

export type Group = 'traffic' | 'cameras' | 'radars' | 'mobile' | 'fuel' | 'ev' | 'tolls' | 'fires' | 'vms' | 'zbe' | 'quakes';

export const GROUPS: { id: Group; label: string; icon: IconName; color: string; hint: string }[] = [
  { id: 'traffic', label: 'Tráfico', icon: 'alert', color: '#ff3b30', hint: 'Accidentes, cortes, obras, nieve y atascos en Madrid y Barcelona' },
  { id: 'cameras', label: 'Cámaras', icon: 'video', color: '#5856d6', hint: 'Imagen en directo de la DGT' },
  { id: 'radars', label: 'Radares', icon: 'cctv', color: '#ff2d55', hint: 'Fijos, de tramo, remolques y zonas de radar móvil' },
  { id: 'mobile', label: 'Controles móviles', icon: 'megaphone', color: '#ff9500', hint: 'Anunciados ahora en paneles y por ayuntamientos; zonas históricas' },
  { id: 'fuel', label: 'Gasolineras', icon: 'fuel', color: '#34c759', hint: 'Precio de hoy y su historia' },
  { id: 'ev', label: 'Recarga', icon: 'zap', color: '#00a6a6', hint: 'Puntos de recarga, estado y precio' },
  { id: 'tolls', label: 'Peajes', icon: 'ticket', color: '#ff9f0a', hint: 'Autopistas de peaje, cabinas y áreas de servicio' },
  { id: 'fires', label: 'Incendios', icon: 'flame', color: '#ff453a', hint: 'Focos detectados por satélite (48 h) y zonas quemadas (30 días)' },
  { id: 'vms', label: 'Paneles', icon: 'panel', color: '#e3a008', hint: 'Lo que dicen ahora los paneles' },
  { id: 'zbe', label: 'Bajas emisiones', icon: 'leaf', color: '#30a46c', hint: 'Zonas ZBE y qué etiquetas entran' },
  { id: 'quakes', label: 'Terremotos', icon: 'activity', color: '#a2845e', hint: 'Últimos 10 días (IGN)' },
];

// How often each group's data is fetched again while visible (seconds).
const REFRESH: Record<Group, number> = { traffic: 180, cameras: 3600, radars: 86400, mobile: 180, fuel: 1800, ev: 86400, tolls: 86400, fires: 1800, vms: 180, zbe: 86400, quakes: 600 };
const SOURCES: Record<Group, string[]> = {
  traffic: ['incidents', 'incident-lines', 'traffic'], cameras: ['cameras'], radars: ['radars', 'radar-sections', 'radar-zones', 'invive', 'motos'],
  mobile: ['radar-alerts', 'radar-mobile'],
  fuel: ['fuel'], ev: ['ev'], tolls: ['tolls'], fires: ['fires'], vms: ['vms'], zbe: ['zbe'], quakes: ['quakes'],
};

export const CLICKABLE = ['traffic-lines', 'traffic-dots', 'inc-points', 'inc-dots', 'inc-dots-far', 'cam-icon', 'cam-dot', 'radar-icon', 'radar-dot', 'radar-sections', 'invive', 'motos',
  'radar-zones', 'radar-zones-ends', 'alert-icon', 'alert-dot', 'mobile-fill',
  'fuel-dot', 'fuel-label', 'toll-line', 'toll-booth', 'services-icon', 'fire-icon', 'fire-dot', 'burnt-fill', 'ev-dot', 'ev-icon', 'ev-live', 'vms-icon', 'zbe-fill', 'quake-dot', 'invive-ends', 'motos-ends'];

const empty = (): FC => ({ type: 'FeatureCollection', features: [] });

export class Layers {
  private map: MlMap;
  private data = new Map<string, FC>();
  private on = new Set<Group>();
  private timers = new Map<Group, number>();
  fuel = 'g95';
  dark = false;
  onData: (name: string, fc: FC) => void = () => {};

  constructor(map: MlMap) {
    this.map = map;
    // Radar markers are generated the first time the map asks for one.
    map.on('styleimagemissing', (e: { id: string }) => {
      const m = /^rs-(\d+)-(\w+)$/.exec(e.id);
      if (!m || this.pending.has(e.id)) return;
      this.pending.add(e.id);
      void radarImage(Number(m[1]), m[2]!, this.dark).then((img) => {
        if (!map.hasImage(e.id)) map.addImage(e.id, img, { pixelRatio: 2 });
        this.pending.delete(e.id);
      });
    });
  }

  private pending = new Set<string>();

  /** Draw every speed-limit / kind combination present in the data before showing it. */
  private async radarImages(fc: FC): Promise<void> {
    const ids = new Set(fc.features.map((f) => `rs-${Number(f.properties?.maxspeed ?? 0) || 0}-${String(f.properties?.kind ?? 'fijo')}`));
    await Promise.all([...ids].filter((id) => !this.map.hasImage(id)).map(async (id) => {
      const [, sp, kind] = id.split('-');
      const img = await radarImage(Number(sp), kind!, this.dark);
      if (!this.map.hasImage(id)) this.map.addImage(id, img, { pixelRatio: 2 });
    }));
  }

  sources(g: Group): string[] {
    return SOURCES[g];
  }

  get(name: string): FC | undefined {
    return this.data.get(name);
  }

  visible(g: Group): boolean {
    return this.on.has(g);
  }

  /** (Re)create every source, image and layer; called after each style load (theme change too). */
  async install(): Promise<void> {
    const m = this.map;
    for (const names of Object.values(SOURCES)) {
      for (const n of names) if (!m.getSource(n)) m.addSource(n, { type: 'geojson', data: this.data.get(n) ?? empty(), promoteId: n === 'incident-lines' || n === 'radar-sections' || n === 'radar-zones' || n === 'invive' || n === 'motos' ? undefined : 'id' });
    }
    if (!m.getSource('ev-live')) m.addSource('ev-live', { type: 'geojson', data: empty() });
    if (!m.getSource('selection')) m.addSource('selection', { type: 'geojson', data: empty() });
    if (!m.getSource('route')) m.addSource('route', { type: 'geojson', data: this.route ?? empty() });
    if (!m.getSource('route-alt')) m.addSource('route-alt', { type: 'geojson', data: this.routeAlt ?? empty() });
    await this.images();
    const radars = this.data.get('radars');
    if (radars) await this.radarImages(radars);
    this.addLayers();
    for (const g of GROUPS) this.applyVisibility(g.id);
    this.applyFuel();
  }

  private async images(): Promise<void> {
    const m = this.map;
    const ring = this.dark ? '#1c1c1e' : '#ffffff';
    const jobs: Promise<void>[] = [];
    const add = (id: string, p: Promise<ImageData>) => {
      if (m.hasImage(id)) return;
      jobs.push(p.then((img) => { if (!m.hasImage(id)) m.addImage(id, img, { pixelRatio: 2 }); }));
    };
    for (const [cat, c] of Object.entries(CATS)) add(`inc-${cat}`, markerImage(c.icon, c.color, 30, 2, ring));
    add('inc-v16', markerImage('siren', V16_COLOR, 30, 2, ring));
    add('cam', squareImage('video', '#5856d6', 24));
    add('vms', squareImage('panel', '#d99a00', 24));
    add('alert-movil', markerImage('megaphone', '#ff9500', 30, 2, ring));
    add('alert-radar', markerImage('megaphone', '#e0201b', 28, 2, ring));
    add('ev-dc', markerImage('zap', '#00a6a6', 26, 2, ring));
    add('ev-ac', markerImage('plug', '#4aa8a8', 24, 2, ring));
    add('fuel-pin', markerImage('fuel', '#34c759', 26, 2, ring));
    add('toll', markerImage('ticket', '#ff9f0a', 24, 2, ring));
    add('svc-services', markerImage('coffee', '#5e5ce6', 22, 2, ring));
    add('svc-rest_area', markerImage('tree', '#7c8a6e', 20, 2, ring));
    add('fire', markerImage('flame', '#ff453a', 28, 2, ring));
    await Promise.all(jobs);
  }

  private addLayers(): void {
    const m = this.map;
    const before = m.getLayer('places_subplace') ? 'places_subplace' : undefined;
    const label = (id: string) => (m.getLayer(id) ? undefined : true);
    const halo = this.dark ? '#1c1c1e' : '#ffffff';
    const text = this.dark ? '#f2f2f7' : '#1c1c1e';
    const add = (spec: Parameters<MlMap['addLayer']>[0], beforeId?: string) => {
      if (label(spec.id)) m.addLayer(spec, beforeId);
    };
    const catColor: ExpressionSpecification = ['match', ['get', 'cat'], ...Object.entries(CATS).flatMap(([k, v]) => [k, v.color]), '#8e8e93'] as unknown as ExpressionSpecification;
    const catRank: ExpressionSpecification = ['match', ['get', 'cat'], ...Object.entries(CATS).flatMap(([k, v]) => [k, v.rank]), 9] as unknown as ExpressionSpecification;

    // ZBE polygons under everything else.
    add({ id: 'zbe-fill', type: 'fill', source: 'zbe', paint: { 'fill-color': '#30a46c', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.22, 14, 0.12] } }, before);
    add({ id: 'zbe-line', type: 'line', source: 'zbe', paint: { 'line-color': '#1f8a57', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2.4], 'line-dasharray': [2, 1.2] } }, before);
    add({ id: 'zbe-label', type: 'symbol', source: 'zbe', minzoom: 10, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'symbol-placement': 'point' }, paint: { 'text-color': this.dark ? '#7fd8a8' : '#1a6b45', 'text-halo-color': halo, 'text-halo-width': 1.6 } });

    // Enforcement stretches: wide translucent bands.
    add({ id: 'invive', type: 'line', source: 'invive', minzoom: 7, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff2d55', 'line-opacity': 0.28, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 9] } }, before);
    add({ id: 'motos', type: 'line', source: 'motos', minzoom: 7, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#af52de', 'line-opacity': 0.4, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 8] } }, before);
    // Stretches without a reliable road geometry: just their two ends.
    add({ id: 'invive-ends', type: 'circle', source: 'invive', minzoom: 7, filter: ['==', ['geometry-type'], 'MultiPoint'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6], 'circle-color': '#ff2d55', 'circle-opacity': 0.45, 'circle-stroke-color': '#ff2d55', 'circle-stroke-width': 1.5 } }, before);
    add({ id: 'motos-ends', type: 'circle', source: 'motos', minzoom: 7, filter: ['==', ['geometry-type'], 'MultiPoint'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6], 'circle-color': '#af52de', 'circle-opacity': 0.45, 'circle-stroke-color': '#af52de', 'circle-stroke-width': 1.5 } }, before);
    // DGT mobile-radar stretches: where checks happen, not where a radar is now. Thin and dashed.
    add({ id: 'radar-zones', type: 'line', source: 'radar-zones', minzoom: 7, filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: {
      'line-color': '#ff6b35', 'line-opacity': 0.55, 'line-dasharray': [2, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 4] } }, before);
    add({ id: 'radar-zones-ends', type: 'circle', source: 'radar-zones', minzoom: 8, filter: ['==', ['geometry-type'], 'MultiPoint'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 5], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ff6b35', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.7 } }, before);
    // Mobile checks: council lists for today (orange) and historical zones from fines (violet, fainter).
    add({ id: 'mobile-fill', type: 'fill', source: 'radar-mobile', paint: {
      'fill-color': ['match', ['get', 'kind'], 'anunciado', '#ff9500', '#8e5cd9'], 'fill-opacity': ['match', ['get', 'kind'], 'anunciado', 0.32, 0.16] } }, before);
    add({ id: 'mobile-line', type: 'line', source: 'radar-mobile', paint: {
      'line-color': ['match', ['get', 'kind'], 'anunciado', '#ff9500', '#8e5cd9'], 'line-opacity': 0.7, 'line-width': 1 } }, before);
    add({ id: 'radar-sections', type: 'line', source: 'radar-sections', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': '#0a84ff', 'line-opacity': ['case', ['==', ['get', 'pos'], 'aproximada'], 0.45, 0.85],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 6] } }, before);

    // Route on top of the base roads.
    add({ id: 'route-alt', type: 'line', source: 'route-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': this.dark ? '#5a6b85' : '#8fa6c9', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 14, 9], 'line-opacity': 0.9 } }, before);
    add({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': this.dark ? '#0b3d91' : '#0a4fc2', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 14, 13] } }, before);
    add({ id: 'route-line', type: 'line', source: 'route', filter: ['!=', ['get', 'toll'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a84ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 14, 9] } }, before);
    add({ id: 'route-toll', type: 'line', source: 'route', filter: ['==', ['get', 'toll'], true], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ff9f0a', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 14, 9] } }, before);

    // Live congestion where cities publish it (Madrid sensors, Barcelona sections).
    const tcolor: ExpressionSpecification = ['match', ['get', 'state'], 1, '#30c15a', 2, '#ffcc00', 3, '#ff9500', 4, '#ff3b30', 5, '#7a0b0b', '#8e8e93'];
    add({ id: 'traffic-lines', type: 'line', source: 'traffic', minzoom: 10, filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'state'] },
      paint: { 'line-color': tcolor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 7], 'line-opacity': 0.9 } }, before);
    add({ id: 'traffic-dots', type: 'circle', source: 'traffic', minzoom: 10, filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'circle-sort-key': ['get', 'state'] },
      paint: { 'circle-color': tcolor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'state'], 1, 1.4, 3], 15, ['match', ['get', 'state'], 1, 3.5, 6.5]],
        'circle-stroke-color': halo, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0, 14, 1], 'circle-opacity': ['match', ['get', 'state'], 1, 0.7, 1] } }, before);

    // Affected stretches of road.
    add({ id: 'inc-lines-casing', type: 'line', source: 'incident-lines', minzoom: 8, layout: { 'line-cap': 'round' }, paint: { 'line-color': halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 12] } }, before);
    add({ id: 'inc-lines', type: 'line', source: 'incident-lines', minzoom: 8, layout: { 'line-cap': 'round' }, paint: { 'line-color': catColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 8] } }, before);

    // Toll motorways: an amber band over the road; booths and service areas closer in.
    add({ id: 'toll-line', type: 'line', source: 'tolls', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff9f0a', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.75, 12, 0.55], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 4, 15, 10] } }, before);
    add({ id: 'services-icon', type: 'symbol', source: 'tolls', minzoom: 10, filter: ['in', ['get', 'kind'], ['literal', ['services', 'rest_area']]],
      layout: { 'icon-image': ['concat', 'svc-', ['get', 'kind']], 'icon-allow-overlap': false, 'symbol-sort-key': ['match', ['get', 'kind'], 'services', 0, 1] } });
    add({ id: 'toll-booth', type: 'symbol', source: 'tolls', minzoom: 7, filter: ['==', ['get', 'kind'], 'booth'],
      layout: { 'icon-image': 'toll', 'icon-allow-overlap': ['step', ['zoom'], false, 10, true], 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 11, 1],
        'text-field': ['step', ['zoom'], '', 11, ['get', 'name']], 'text-font': ['Noto Sans Medium'], 'text-size': 11.5, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.6 } });

    // Wildfires: burnt areas, then a glow and a flame for each active heat spot (chimneys hidden).
    add({ id: 'burnt-fill', type: 'fill', source: 'fires', filter: ['==', ['get', 'kind'], 'burnt'], paint: { 'fill-color': this.dark ? '#8a4b2a' : '#7a3b1d', 'fill-opacity': 0.45, 'fill-outline-color': '#5a2a12' } }, before);
    const hot: ExpressionSpecification = ['all', ['==', ['get', 'kind'], 'hotspot'], ['!=', ['get', 'persistent'], true]];
    add({ id: 'fire-glow', type: 'circle', source: 'fires', filter: hot, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 'frp'], 0, 5, 50, 10, 500, 22], 12, ['interpolate', ['linear'], ['get', 'frp'], 0, 18, 50, 36, 500, 70]],
      'circle-color': '#ff6a00', 'circle-opacity': 0.25, 'circle-blur': 0.6 } });
    add({ id: 'fire-dot', type: 'circle', source: 'fires', maxzoom: 8, filter: hot, paint: { 'circle-radius': 4, 'circle-color': '#ff453a', 'circle-stroke-color': halo, 'circle-stroke-width': 1.2 } });
    add({ id: 'fire-icon', type: 'symbol', source: 'fires', minzoom: 8, filter: hot, layout: { 'icon-image': 'fire', 'icon-allow-overlap': true } });

    // Fuel: coloured dot by price percentile; price label when close.
    add({ id: 'fuel-dot', type: 'circle', source: 'fuel', paint: {
      'circle-opacity': ['case', ['==', ['get', 'closed'], true], 0.3, 1], 'circle-stroke-opacity': ['case', ['==', ['get', 'closed'], true], 0.3, 1],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 9, 3.2, 12, 6, 15, 8],
      'circle-color': '#8e8e93', 'circle-stroke-color': halo, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 10, 1.2] } });
    add({ id: 'fuel-label', type: 'symbol', source: 'fuel', minzoom: 11.5, layout: {
      'text-field': '', 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.25], 'text-anchor': 'top',
      'text-allow-overlap': false, 'symbol-sort-key': 0 }, paint: { 'text-opacity': ['case', ['==', ['get', 'closed'], true], 0.45, 1], 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.8 } });

    // Charging points.
    add({ id: 'ev-dot', type: 'circle', source: 'ev', maxzoom: 11, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'dc'], 2.4, 1.4], 10, ['case', ['get', 'dc'], 4.5, 3]],
      'circle-color': ['case', ['get', 'dc'], '#00a6a6', '#62bcbc'], 'circle-stroke-color': halo, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 10, 1] } });
    add({ id: 'ev-icon', type: 'symbol', source: 'ev', minzoom: 11, layout: { 'icon-image': ['case', ['get', 'dc'], 'ev-dc', 'ev-ac'], 'icon-allow-overlap': true, 'symbol-sort-key': ['-', ['get', 'kw']] } });
    add({ id: 'ev-live', type: 'circle', source: 'ev-live', minzoom: 13, paint: {
      'circle-radius': ['case', ['==', ['get', 't'], 'c'], 9, 7], 'circle-color': ['match', ['get', 'status'], 'AVAILABLE', '#34c759', 'CHARGING', '#0a84ff', 'BLOCKED', '#0a84ff', 'RESERVED', '#0a84ff', 'OUTOFORDER', '#ff3b30', 'INOPERATIVE', '#ff3b30', '#8e8e93'],
      'circle-stroke-color': halo, 'circle-stroke-width': 2.5, 'circle-translate': [12, -12] } });

    // Cameras and panels: square markers.
    add({ id: 'cam-dot', type: 'circle', source: 'cameras', minzoom: 6.5, maxzoom: 9, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 9, 3.4], 'circle-color': '#5856d6', 'circle-stroke-color': halo, 'circle-stroke-width': 0.8 } });
    add({ id: 'cam-icon', type: 'symbol', source: 'cameras', minzoom: 9, layout: { 'icon-image': 'cam', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 12, 1] } });
    add({ id: 'vms-icon', type: 'symbol', source: 'vms', minzoom: 7, filter: ['==', ['get', 'on'], true], layout: { 'icon-image': 'vms', 'icon-allow-overlap': ['step', ['zoom'], false, 11, true], 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 11, 1] } });

    // Radars.
    add({ id: 'radar-dot', type: 'circle', source: 'radars', minzoom: 5, maxzoom: 9, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 9, 3.6], 'circle-color': ['match', ['get', 'kind'], 'tramo', '#0a84ff', 'semaforo', '#8e44ad', 'cinturon', '#0f9d8a', 'linea', '#f08a24', 'stop', '#b3261e', 'remolque', '#ff9500', '#e0201b'],
      'circle-stroke-color': halo, 'circle-stroke-width': 0.8 } });
    // Speed-limit sign markers, drawn on demand for each limit and kind (see installRadarImages).
    add({ id: 'radar-icon', type: 'symbol', source: 'radars', minzoom: 9, layout: {
      'icon-image': ['concat', 'rs-', ['to-string', ['coalesce', ['get', 'maxspeed'], 0]], '-', ['coalesce', ['get', 'kind'], 'fijo']],
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1],
      'symbol-sort-key': ['coalesce', ['get', 'maxspeed'], 0] } });

    // Speed checks announced by the DGT's message signs right now.
    add({ id: 'alert-dot', type: 'circle', source: 'radar-alerts', maxzoom: 8, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 5], 'circle-color': ['match', ['get', 'kind'], 'movil', '#ff9500', '#e0201b'],
      'circle-stroke-color': halo, 'circle-stroke-width': 1.2 } });
    add({ id: 'alert-icon', type: 'symbol', source: 'radar-alerts', minzoom: 8, layout: {
      'icon-image': ['match', ['get', 'kind'], 'movil', 'alert-movil', 'alert-radar'], 'icon-allow-overlap': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.75, 12, 1] } });

    // Earthquakes.
    add({ id: 'quake-dot', type: 'circle', source: 'quakes', paint: {
      'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'mag'], 1], 1, 4, 3, 8, 5, 16, 7, 30],
      'circle-color': '#a2845e', 'circle-opacity': 0.35, 'circle-stroke-color': '#7a5c36', 'circle-stroke-width': 1.5 } });

    // Incidents on top: small dots far away, full markers closer. Most serious first.
    add({ id: 'inc-dots-far', type: 'circle', source: 'incidents', maxzoom: 6, filter: ['<=', catRank, 4], layout: { 'circle-sort-key': ['-', 10, catRank] }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['<=', catRank, 3], 4, 2.4], 7.5, ['case', ['<=', catRank, 3], 6, 4]],
      'circle-color': catColor, 'circle-stroke-color': halo, 'circle-stroke-width': 1.2 } });
    add({ id: 'inc-dots', type: 'circle', source: 'incidents', maxzoom: 7.5, minzoom: 6, layout: { 'circle-sort-key': ['-', 10, catRank] }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['<=', catRank, 3], 4, 2.4], 7.5, ['case', ['<=', catRank, 3], 6, 4]],
      'circle-color': catColor, 'circle-stroke-color': halo, 'circle-stroke-width': 1.2 } });
    add({ id: 'inc-points', type: 'symbol', source: 'incidents', minzoom: 7.5, layout: {
      'icon-image': ['case', ['has', 'v16'], 'inc-v16', ['concat', 'inc-', ['get', 'cat']]], 'icon-allow-overlap': true,
      'symbol-sort-key': catRank,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7.5, ['case', ['>=', ['coalesce', ['get', 'days'], 0], 7], 0.62, 0.8], 12, ['case', ['>=', ['coalesce', ['get', 'days'], 0], 7], 0.78, 1]] },
      paint: { 'icon-opacity': ['case', ['>=', ['coalesce', ['get', 'days'], 0], 7], 0.6, 1] } });

    // Selection halo.
    add({ id: 'selection', type: 'circle', source: 'selection', paint: { 'circle-radius': 22, 'circle-color': 'rgba(10,132,255,0.16)', 'circle-stroke-color': '#0a84ff', 'circle-stroke-width': 2.5 } });
    add({ id: 'route-ends', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['case', ['==', ['get', 'end'], 'from'], '#ffffff', '#0a84ff'], 'circle-stroke-color': ['case', ['==', ['get', 'end'], 'from'], '#0a84ff', '#ffffff'], 'circle-stroke-width': 3 } });
  }

  private layerIds(g: Group): string[] {
    return {
      traffic: ['traffic-lines', 'traffic-dots', 'inc-lines-casing', 'inc-lines', 'inc-dots-far', 'inc-dots', 'inc-points'],
      cameras: ['cam-dot', 'cam-icon'],
      radars: ['radar-dot', 'radar-icon', 'radar-sections', 'radar-zones', 'radar-zones-ends', 'invive', 'motos', 'invive-ends', 'motos-ends'],
      mobile: ['mobile-fill', 'mobile-line', 'alert-dot', 'alert-icon'],
      fuel: ['fuel-dot', 'fuel-label'],
      ev: ['ev-dot', 'ev-icon', 'ev-live'],
      tolls: ['toll-line', 'toll-booth', 'services-icon'],
      fires: ['burnt-fill', 'fire-glow', 'fire-dot', 'fire-icon'],
      vms: ['vms-icon'],
      zbe: ['zbe-fill', 'zbe-line', 'zbe-label'],
      quakes: ['quake-dot'],
    }[g];
  }

  private applyVisibility(g: Group): void {
    for (const id of this.layerIds(g)) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.on.has(g) ? 'visible' : 'none');
  }

  async set(g: Group, visible: boolean): Promise<void> {
    if (visible) this.on.add(g);
    else this.on.delete(g);
    this.applyVisibility(g);
    window.clearInterval(this.timers.get(g));
    if (visible) {
      await this.load(g);
      this.timers.set(g, window.setInterval(() => void this.load(g), REFRESH[g] * 1000));
    }
  }

  async load(g: Group): Promise<void> {
    let ok = 0;
    await Promise.all(SOURCES[g].map(async (name) => {
      // One missing source (e.g. a city feed that is down) must not hide the rest of the layer.
      const fc = await live<FC>(name, REFRESH[g] / 2).catch(() => null);
      if (!fc) return;
      ok++;
      if (name === 'radars') await this.radarImages(fc);
      if (name === 'fuel') markClosed(fc);
      this.data.set(name, fc);
      (this.map.getSource(name) as GeoJSONSource | undefined)?.setData(fc);
      this.onData(name, fc);
    }));
    if (!ok) throw new Error(`${g}: sin datos`);
    if (g === 'fuel') this.applyFuel();
  }

  /** Colour fuel stations by the chosen fuel: green the cheapest fifth, red the dearest. */
  setFuel(code: string): void {
    this.fuel = code;
    this.applyFuel();
  }

  private applyFuel(): void {
    const m = this.map;
    if (!m.getLayer('fuel-dot')) return;
    const key = `p_${this.fuel}`;
    const pct = this.data.get('fuel')?.pct?.[this.fuel] ?? [1, 1.2, 1.4, 1.6, 1.8];
    const [, q25, q50, q75] = pct;
    const color: ExpressionSpecification = ['case', ['!', ['has', key]], 'rgba(142,142,147,0)',
      ['interpolate', ['linear'], ['get', key], q25!, '#1fa34a', q50!, '#ffcc00', q75!, '#ff3b30']];
    m.setPaintProperty('fuel-dot', 'circle-color', color);
    m.setPaintProperty('fuel-dot', 'circle-stroke-color', ['case', ['has', key], this.dark ? '#1c1c1e' : '#ffffff', 'rgba(0,0,0,0)']);
    m.setLayoutProperty('fuel-label', 'text-field', ['case', ['has', key], ['number-format', ['get', key], { locale: 'es-ES', 'min-fraction-digits': 3, 'max-fraction-digits': 3 }], '']);
    m.setLayoutProperty('fuel-label', 'symbol-sort-key', ['coalesce', ['get', key], 99]);
  }

  setLive(fc: FC): void {
    (this.map.getSource('ev-live') as GeoJSONSource | undefined)?.setData(fc);
  }

  select(f: { lon: number; lat: number } | null): void {
    (this.map.getSource('selection') as GeoJSONSource | undefined)?.setData(f ? { type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: {} } : empty());
  }

  private route: FC | null = null;
  private routeAlt: FC | null = null;

  setRoute(fc: FC | null, alt: FC | null = null): void {
    this.route = fc;
    this.routeAlt = alt;
    (this.map.getSource('route') as GeoJSONSource | undefined)?.setData(fc ?? empty());
    (this.map.getSource('route-alt') as GeoJSONSource | undefined)?.setData(alt ?? empty());
  }

  /** Opening hours change with the clock, not with the data: re-mark closed stations. */
  refreshOpen(): void {
    const fc = this.data.get('fuel');
    if (!fc) return;
    markClosed(fc);
    (this.map.getSource('fuel') as GeoJSONSource | undefined)?.setData(fc);
  }

  features(name: string): GeoJSON.Feature[] {
    return this.data.get(name)?.features ?? [];
  }
}

export function featureGroup(f: MapGeoJSONFeature): Group | 'ev-live' | null {
  const s = f.source;
  if (s === 'incidents' || s === 'incident-lines' || s === 'traffic') return 'traffic';
  if (s === 'cameras') return 'cameras';
  if (s === 'radars' || s === 'radar-sections' || s === 'radar-zones' || s === 'invive' || s === 'motos') return 'radars';
  if (s === 'radar-alerts' || s === 'radar-mobile') return 'mobile';
  if (s === 'fuel') return 'fuel';
  if (s === 'ev') return 'ev';
  if (s === 'ev-live') return 'ev-live';
  if (s === 'tolls') return 'tolls';
  if (s === 'fires') return 'fires';
  if (s === 'vms') return 'vms';
  if (s === 'zbe') return 'zbe';
  if (s === 'quakes') return 'quakes';
  return null;
}

/** Adds `closed: true` to the stations closed right now (by their published opening hours). */
export function markClosed(fc: FC): void {
  const now = new Date();
  for (const f of fc.features) {
    const p = f.properties as { hours?: string; prov?: string; closed?: boolean };
    p.closed = openState(p.hours ?? '', p.prov ?? '', now).open === false;
  }
}

export type { Cat };
