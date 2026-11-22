// Trip planner: route with our own Valhalla server, then everything along it — incidents, radars,
// cameras, the cheapest fuel and fast chargers a short detour away, and low-emission zones.
import type { LngLatBoundsLike } from 'maplibre-gl';
import { CATS, esc, FUEL_LABEL, km, nf, price, titleCase, type Camera, type Charger, type FC, type Incident, type Radar, type Station, type Zone } from '../data.ts';
import type { Ctx } from './details.ts';
import { incidentList } from './details.ts';
import { icon, iconSvg } from './icons.ts';
import { SearchBox, type Place } from './search.ts';

/** Decode a Valhalla polyline (precision 6). */
export function decode(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lon += d;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** Spatial index of a polyline to measure distances from many points quickly (metres). */
export class Corridor {
  private cells = new Map<string, number[]>();
  private pts: [number, number][];
  private cum: number[] = [0];
  private kx: number;
  private readonly cell = 0.02;

  constructor(line: [number, number][]) {
    this.pts = line;
    const lat0 = line.reduce((s, p) => s + p[1], 0) / Math.max(1, line.length);
    this.kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i]!, line[i + 1]!];
      this.cum.push(this.cum[i]! + Math.hypot((b[0] - a[0]) * this.kx, (b[1] - a[1]) * 110540));
      const x0 = Math.floor(Math.min(a[0], b[0]) / this.cell);
      const x1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / this.cell);
      const y1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push(i);
        else this.cells.set(k, [i]);
      }
    }
  }

  /** [distance to the route in m, distance along the route in m] or null if farther than `max`. */
  measure(p: [number, number], max: number): [number, number] | null {
    const cx = Math.floor(p[0] / this.cell);
    const cy = Math.floor(p[1] / this.cell);
    const r = Math.ceil(max / 1500);
    let best = Infinity;
    let along = 0;
    const seen = new Set<number>();
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const i of this.cells.get(`${x},${y}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const a = this.pts[i]!;
        const b = this.pts[i + 1]!;
        const ax = (a[0] - p[0]) * this.kx;
        const ay = (a[1] - p[1]) * 110540;
        const bx = (b[0] - p[0]) * this.kx;
        const by = (b[1] - p[1]) * 110540;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) {
          best = d;
          along = this.cum[i]! + t * Math.sqrt(len2);
        }
      }
    }
    return best <= max ? [best, along] : null;
  }
}

interface Leg { from: Place; to: Place }

export class Planner {
  private ctx: Ctx;
  private leg: Partial<Leg> = {};
  private boxFrom: SearchBox;
  private boxTo: SearchBox;
  private el: HTMLElement;
  private out: HTMLElement;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.el = document.createElement('div');
    this.el.className = 'planner';
    this.boxFrom = new SearchBox((p) => this.set('from', p), 'Origen');
    this.boxTo = new SearchBox((p) => this.set('to', p), 'Destino');
    const fields = document.createElement('div');
    fields.className = 'planner-fields';
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'icon-btn ghost swap';
    swap.setAttribute('aria-label', 'Intercambiar origen y destino');
    swap.append(icon('swap', 18));
    swap.addEventListener('click', () => {
      const { from, to } = this.leg;
      this.leg = { from: to, to: from };
      this.boxFrom.input.value = to?.short ?? '';
      this.boxTo.input.value = from?.short ?? '';
      void this.run();
    });
    const me = document.createElement('button');
    me.type = 'button';
    me.className = 'link-btn';
    me.append(icon('locate', 15), 'Usar mi ubicación como origen');
    me.addEventListener('click', () => {
      navigator.geolocation?.getCurrentPosition((pos) => {
        this.boxFrom.input.value = 'Mi ubicación';
        this.set('from', { label: 'Mi ubicación', short: 'Mi ubicación', lon: pos.coords.longitude, lat: pos.coords.latitude });
      }, () => { me.textContent = 'No se pudo obtener tu ubicación'; }, { enableHighAccuracy: true, timeout: 10000 });
    });
    fields.append(this.boxFrom.el, swap, this.boxTo.el);
    this.out = document.createElement('div');
    this.out.className = 'planner-out';
    this.el.append(fields, me, this.out);
    this.boxFrom.local = this.boxTo.local = () => [];
  }

  open(dest?: Place): void {
    if (dest) {
      this.leg.to = dest;
      this.boxTo.input.value = dest.short;
    }
    this.ctx.sheet.show('Planificar un viaje', 'Ruta con todo lo que hay en el camino', this.el, { push: this.ctx.sheet.isOpen && !!dest });
    if (this.leg.from && this.leg.to) void this.run();
    else if (!this.leg.from) this.boxFrom.input.focus();
  }

  private set(which: 'from' | 'to', p: Place): void {
    this.leg[which] = p;
    if (this.leg.from && this.leg.to) void this.run();
  }

  private async run(): Promise<void> {
    const { from, to } = this.leg;
    if (!from || !to) return;
    this.out.innerHTML = `<p class="muted loading">${iconSvg('loader', 16)} Calculando la ruta…</p>`;
    try {
      const body = {
        locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
        costing: 'auto', units: 'kilometers', language: 'es-ES', directions_options: { units: 'kilometers', language: 'es-ES' },
      };
      const r = await fetch('/route/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.trip) throw new Error(j?.error ?? `HTTP ${r.status}`);
      const shape: [number, number][] = j.trip.legs.flatMap((l: { shape: string }) => decode(l.shape));
      const dist = j.trip.summary.length as number;
      const secs = j.trip.summary.time as number;
      await this.render(from, to, shape, dist, secs);
    } catch (e) {
      this.out.innerHTML = `<p class="warn">No se pudo calcular la ruta: ${esc((e as Error).message)}. El calculador de rutas cubre España peninsular, Baleares y Canarias por separado.</p>`;
      this.ctx.layers.setRoute(null);
    }
  }

  private async render(from: Place, to: Place, shape: [number, number][], distKm: number, secs: number): Promise<void> {
    const { ctx } = this;
    ctx.layers.setRoute({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: shape }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [from.lon, from.lat] }, properties: { end: 'from' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [to.lon, to.lat] }, properties: { end: 'to' } },
    ] } as FC);
    const xs = shape.map((p) => p[0]);
    const ys = shape.map((p) => p[1]);
    const pad = ctx.sheet.isMobile() ? { top: 90, bottom: window.innerHeight * 0.5, left: 30, right: 30 } : { top: 80, bottom: 60, left: 440, right: 80 };
    ctx.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] as LngLatBoundsLike, { padding: pad, duration: 900 });
    const cor = new Corridor(shape);
    // Make sure the layers we look along the route are loaded even if hidden.
    await Promise.all((['traffic', 'radars', 'cameras', 'fuel', 'ev', 'zbe'] as const).map((g) => (ctx.layers.get(g === 'traffic' ? 'incidents' : g === 'radars' ? 'radars' : g) ? null : ctx.layers.load(g))));
    const along = <P>(source: string, max: number, filter: (p: P) => boolean = () => true) =>
      ctx.layers.features(source).map((f) => {
        const pt = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null;
        const m = pt ? cor.measure(pt, max) : null;
        return m && filter(f.properties as P) ? { f, p: f.properties as P, off: m[0], at: m[1], pt: pt! } : null;
      }).filter(<T>(x: T | null): x is T => !!x).sort((a, b) => a.at - b.at);

    const inc = along<Incident>('incidents', 250, (p) => p.cat !== 'obras' || true);
    const serious = inc.filter((x) => ['accidente', 'cerrada', 'nieve', 'retencion', 'meteo', 'obstaculo'].includes(x.p.cat));
    const rad = along<Radar>('radars', 120);
    const cams = along<Camera>('cameras', 300);
    const fuelCode = ctx.layers.fuel;
    const fuel = along<Station>('fuel', 1500, (p) => typeof p[`p_${fuelCode}`] === 'number' && p.public);
    const ev = along<Charger>('ev', 1500, (p) => p.dc && p.kw >= 50);
    const zones = ctx.layers.features('zbe').filter((f) => {
      const g = f.geometry as GeoJSON.MultiPolygon;
      return g.coordinates.some((poly) => inside([to.lon, to.lat], poly[0] as [number, number][]));
    }).map((f) => f.properties as unknown as Zone);

    const hrs = Math.floor(secs / 3600);
    const mins = Math.round((secs % 3600) / 60);
    const cheapest = [...fuel].sort((a, b) => (a.p[`p_${fuelCode}`] as number) - (b.p[`p_${fuelCode}`] as number)).slice(0, 5);
    const median = fuel.length ? (fuel.map((x) => x.p[`p_${fuelCode}`] as number).sort((a, b) => a - b)[Math.floor(fuel.length / 2)]!) : 0;
    const el = document.createElement('div');
    el.innerHTML = `<div class="trip"><div><b>${hrs ? `${hrs} h ` : ''}${mins} min</b><span>${nf.format(Math.round(distKm))} km</span></div>
      <div><b>${serious.length}</b><span>avisos</span></div><div><b>${rad.length}</b><span>radares</span></div><div><b>${cams.length}</b><span>cámaras</span></div></div>
      ${zones.length ? `<p class="warn">${iconSvg('leaf', 16)} El destino está en una zona de bajas emisiones: ${zones.map((z) => esc(z.name)).join(', ')}.</p>` : ''}`;
    const sec = (title: string, node: HTMLElement | string) => {
      const box = document.createElement('section');
      box.innerHTML = `<h3 class="sec">${title}</h3>`;
      if (typeof node === 'string') box.insertAdjacentHTML('beforeend', node);
      else box.append(node);
      el.append(box);
    };
    if (inc.length) sec(`En la ruta ahora (${inc.length})`, incidentList(ctx, inc.slice(0, 30).map((x) => x.f)));
    else sec('En la ruta ahora', '<p class="muted">Sin incidencias publicadas en el recorrido.</p>');
    if (cheapest.length) {
      const ul = document.createElement('ul');
      ul.className = 'list';
      for (const x of cheapest) {
        const v = x.p[`p_${fuelCode}`] as number;
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span class="price-chip">${price(v)}</span><span><b>${esc(x.p.brand)}</b><br><small>${esc(titleCase(x.p.muni))} · km ${nf.format(Math.round(x.at / 1000))} de la ruta${x.off > 300 ? ` · desvío ${nf.format(Math.round(x.off / 100) / 10)} km` : ''}</small></span>
          <small class="muted">${median && v < median ? `−${Math.round((median - v) * 50)} € en 50 l` : ''}</small>`;
        b.addEventListener('click', () => {
          ctx.map.flyTo({ center: x.pt, zoom: 14 });
          ctx.open('fuel', x.p as unknown as Record<string, unknown>, x.pt[0], x.pt[1], true);
        });
        li.append(b);
        ul.append(li);
      }
      sec(`${esc(FUEL_LABEL[fuelCode] ?? fuelCode)} más barata en el camino`, ul);
    }
    if (ev.length) {
      const ul = document.createElement('ul');
      ul.className = 'list';
      for (const x of ev.slice(0, 40).filter((_, i, a) => i % Math.ceil(a.length / 8) === 0)) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span class="price-chip ev">${nf.format(x.p.kw)} kW</span><span><b>${esc(x.p.op || x.p.name)}</b><br><small>${esc(titleCase(x.p.muni))} · km ${nf.format(Math.round(x.at / 1000))}</small></span>`;
        b.addEventListener('click', () => {
          ctx.map.flyTo({ center: x.pt, zoom: 15 });
          ctx.open('ev', x.p as unknown as Record<string, unknown>, x.pt[0], x.pt[1], true);
        });
        li.append(b);
        ul.append(li);
      }
      sec(`Recarga rápida en el camino (${ev.length})`, ul);
    }
    if (rad.length) {
      sec(`Radares fijos y de tramo (${rad.length})`, `<p class="small">${rad.map((x) => `<span class="chip">${esc(x.p.road)} ${esc(km(x.p.km))}${x.p.kind === 'tramo' ? ' · tramo' : ''}</span>`).join(' ')}</p>`);
    }
    if (cams.length) {
      const strip = document.createElement('div');
      strip.className = 'cam-strip';
      for (const x of cams.filter((_, i, a) => i % Math.ceil(a.length / 12) === 0)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cam-thumb';
        b.innerHTML = `<img loading="lazy" alt="Cámara ${esc(x.p.road)}" src="/cam/${esc(x.p.id)}.jpg?t=${Math.floor(Date.now() / 120000)}"><span>${esc(x.p.road)} · km ${nf.format(Math.round(x.at / 1000))}</span>`;
        b.addEventListener('click', () => ctx.open('camera', x.p as unknown as Record<string, unknown>, x.pt[0], x.pt[1], true));
        strip.append(b);
      }
      sec('Cámaras a lo largo del viaje', strip);
    }
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'Tiempo estimado sin tráfico, calculado con OpenStreetMap. Avisos a menos de 250 m del trazado; gasolineras y cargadores a menos de 1,5 km.';
    el.append(note);
    void CATS;
    this.out.replaceChildren(el);
  }
}

function inside(p: [number, number], ring: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
