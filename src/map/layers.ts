// Data layers on top of the base map: sources, styling, visibility and periodic refresh.
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl';
import { CATS, live, type Cat, type FC } from '../data.ts';
import { markerImage, squareImage, type IconName } from '../ui/icons.ts';

export type Group = 'traffic' | 'cameras' | 'radars' | 'fuel' | 'ev' | 'vms' | 'zbe' | 'quakes';

export const GROUPS: { id: Group; label: string; icon: IconName; color: string; hint: string }[] = [
  { id: 'traffic', label: 'Tráfico', icon: 'alert', color: '#ff3b30', hint: 'Accidentes, cortes, obras, nieve y retenciones' },
  { id: 'cameras', label: 'Cámaras', icon: 'video', color: '#5856d6', hint: 'Imagen en directo de la DGT' },
  { id: 'radars', label: 'Radares', icon: 'radar', color: '#ff2d55', hint: 'Fijos, de tramo y tramos vigilados' },
  { id: 'fuel', label: 'Gasolineras', icon: 'fuel', color: '#34c759', hint: 'Precio de hoy y su historia' },
  { id: 'ev', label: 'Recarga', icon: 'zap', color: '#00a6a6', hint: 'Puntos de recarga, estado y precio' },
  { id: 'vms', label: 'Paneles', icon: 'panel', color: '#e3a008', hint: 'Lo que dicen ahora los paneles' },
  { id: 'zbe', label: 'Bajas emisiones', icon: 'leaf', color: '#30a46c', hint: 'Zonas ZBE y qué etiquetas entran' },
  { id: 'quakes', label: 'Terremotos', icon: 'activity', color: '#a2845e', hint: 'Últimos 10 días (IGN)' },
];

// How often each group's data is fetched again while visible (seconds).
const REFRESH: Record<Group, number> = { traffic: 180, cameras: 3600, radars: 86400, fuel: 1800, ev: 86400, vms: 180, zbe: 86400, quakes: 600 };
const SOURCES: Record<Group, string[]> = {
  traffic: ['incidents', 'incident-lines'], cameras: ['cameras'], radars: ['radars', 'radar-sections', 'invive', 'motos'],
  fuel: ['fuel'], ev: ['ev'], vms: ['vms'], zbe: ['zbe'], quakes: ['quakes'],
};

export const CLICKABLE = ['inc-points', 'inc-dots', 'inc-dots-far', 'cam-icon', 'cam-dot', 'radar-icon', 'radar-dot', 'radar-sections', 'invive', 'motos',
  'fuel-dot', 'fuel-label', 'ev-dot', 'ev-icon', 'ev-live', 'vms-icon', 'zbe-fill', 'quake-dot'];

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
      for (const n of names) if (!m.getSource(n)) m.addSource(n, { type: 'geojson', data: this.data.get(n) ?? empty(), promoteId: n === 'incident-lines' || n === 'radar-sections' || n === 'invive' || n === 'motos' ? undefined : 'id' });
    }
    if (!m.getSource('ev-live')) m.addSource('ev-live', { type: 'geojson', data: empty() });
    if (!m.getSource('selection')) m.addSource('selection', { type: 'geojson', data: empty() });
    if (!m.getSource('route')) m.addSource('route', { type: 'geojson', data: empty() });
    await this.images();
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
    add('cam', squareImage('video', '#5856d6', 24));
    add('radar-fijo', markerImage('radar', '#ff2d55', 26, 2, ring));
    add('radar-tramo', markerImage('gauge', '#ff2d55', 26, 2, ring));
    add('vms', squareImage('panel', '#d99a00', 24));
    add('ev-dc', markerImage('zap', '#00a6a6', 26, 2, ring));
    add('ev-ac', markerImage('plug', '#4aa8a8', 24, 2, ring));
    add('fuel-pin', markerImage('fuel', '#34c759', 26, 2, ring));
    add('radar-osm', markerImage('radar', '#ff6b8a', 22, 2, ring));
    add('radar-semaforo', markerImage('radar', '#bf5af2', 22, 2, ring));
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
    add({ id: 'radar-sections', type: 'line', source: 'radar-sections', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff2d55', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 6], 'line-dasharray': [1.5, 1] } }, before);

    // Route on top of the base roads.
    add({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': this.dark ? '#0b3d91' : '#0a4fc2', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 14, 13] } }, before);
    add({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a84ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 14, 9] } }, before);

    // Affected stretches of road.
    add({ id: 'inc-lines-casing', type: 'line', source: 'incident-lines', minzoom: 8, layout: { 'line-cap': 'round' }, paint: { 'line-color': halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 12] } }, before);
    add({ id: 'inc-lines', type: 'line', source: 'incident-lines', minzoom: 8, layout: { 'line-cap': 'round' }, paint: { 'line-color': catColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 8] } }, before);

    // Fuel: coloured dot by price percentile; price label when close.
    add({ id: 'fuel-dot', type: 'circle', source: 'fuel', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 9, 3.2, 12, 6, 15, 8],
      'circle-color': '#8e8e93', 'circle-stroke-color': halo, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 10, 1.2] } });
    add({ id: 'fuel-label', type: 'symbol', source: 'fuel', minzoom: 11.5, layout: {
      'text-field': '', 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.25], 'text-anchor': 'top',
      'text-allow-overlap': false, 'symbol-sort-key': 0 }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.8 } });

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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 9, 3.6], 'circle-color': ['case', ['==', ['get', 'src'], 'osm'], '#ff6b8a', '#ff2d55'],
      'circle-stroke-color': halo, 'circle-stroke-width': 0.8 } });
    add({ id: 'radar-icon', type: 'symbol', source: 'radars', minzoom: 9, layout: {
      'icon-image': ['case', ['==', ['get', 'kind'], 'tramo'], 'radar-tramo', ['==', ['get', 'kind'], 'semaforo'], 'radar-semaforo', ['==', ['get', 'src'], 'osm'], 'radar-osm', 'radar-fijo'],
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 12, ['to-string', ['coalesce', ['get', 'maxspeed'], '']]], 'text-font': ['Noto Sans Medium'], 'text-size': 11,
      'text-offset': [1.35, 0], 'text-anchor': 'left', 'text-optional': true },
      paint: { 'text-color': '#ff2d55', 'text-halo-color': halo, 'text-halo-width': 2 } });

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
      'icon-image': ['concat', 'inc-', ['get', 'cat']], 'icon-allow-overlap': true,
      'symbol-sort-key': catRank, 'icon-size': ['interpolate', ['linear'], ['zoom'], 7.5, 0.8, 12, 1] } });

    // Selection halo.
    add({ id: 'selection', type: 'circle', source: 'selection', paint: { 'circle-radius': 22, 'circle-color': 'rgba(10,132,255,0.16)', 'circle-stroke-color': '#0a84ff', 'circle-stroke-width': 2.5 } });
    add({ id: 'route-ends', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['case', ['==', ['get', 'end'], 'from'], '#ffffff', '#0a84ff'], 'circle-stroke-color': ['case', ['==', ['get', 'end'], 'from'], '#0a84ff', '#ffffff'], 'circle-stroke-width': 3 } });
  }

  private layerIds(g: Group): string[] {
    return {
      traffic: ['inc-lines-casing', 'inc-lines', 'inc-dots-far', 'inc-dots', 'inc-points'],
      cameras: ['cam-dot', 'cam-icon'],
      radars: ['radar-dot', 'radar-icon', 'radar-sections', 'invive', 'motos'],
      fuel: ['fuel-dot', 'fuel-label'],
      ev: ['ev-dot', 'ev-icon', 'ev-live'],
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
    await Promise.all(SOURCES[g].map(async (name) => {
      const fc = await live<FC>(name, REFRESH[g] / 2);
      this.data.set(name, fc);
      (this.map.getSource(name) as GeoJSONSource | undefined)?.setData(fc);
      this.onData(name, fc);
    }));
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

  setRoute(fc: FC | null): void {
    (this.map.getSource('route') as GeoJSONSource | undefined)?.setData(fc ?? empty());
  }

  features(name: string): GeoJSON.Feature[] {
    return this.data.get(name)?.features ?? [];
  }
}

export function featureGroup(f: MapGeoJSONFeature): Group | 'ev-live' | null {
  const s = f.source;
  if (s === 'incidents' || s === 'incident-lines') return 'traffic';
  if (s === 'cameras') return 'cameras';
  if (s === 'radars' || s === 'radar-sections' || s === 'invive' || s === 'motos') return 'radars';
  if (s === 'fuel') return 'fuel';
  if (s === 'ev') return 'ev';
  if (s === 'ev-live') return 'ev-live';
  if (s === 'vms') return 'vms';
  if (s === 'zbe') return 'zbe';
  if (s === 'quakes') return 'quakes';
  return null;
}

export type { Cat };
