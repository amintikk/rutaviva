// Address search with the CartoCiudad geocoder (IGN), through our own /ign/geocoder proxy.
// "candidates" suggests matches while typing; "find" returns the geometry of the chosen one
// (a point, a street line or a municipality polygon), which we frame on the map.
import { icon, type IconName } from './icons.ts';

const t = (s: string, v: Record<string, string> = {}) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

export interface Candidate {
  id: string;
  type: string;
  address: string;
  muni?: string;
  province?: string;
  poblacion?: string;
  portalNumber?: number | null;
  lat: number;
  lng: number;
  geom?: string | null;
  bbox?: [number, number, number, number];
}

export interface Place {
  label: string;
  short: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
}

const API = '/ign/geocoder';

export async function candidates(q: string, signal?: AbortSignal): Promise<Candidate[]> {
  const r = await fetch(`${API}/candidates?q=${encodeURIComponent(q)}&limit=7&countrycodes=es`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const list = (await r.json()) as Candidate[];
  return Array.isArray(list) ? list : [];
}

/** All coordinate pairs of a WKT geometry. */
export function wktCoords(wkt: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

function title(s: string): string {
  // CartoCiudad writes street names in capitals; soften them for display.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(/'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y|A|En)\b/g, (w) => w.toLowerCase());
}

export function describe(c: Candidate): { main: string; sub: string; kind: IconName } {
  if (c.type === 'local') return { main: c.address, sub: c.muni ?? '', kind: 'road' };
  const kind: IconName = c.type === 'portal' || c.type === 'callejero' || c.type === 'carretera' ? 'road' : c.type === 'Municipio' || c.type === 'poblacion' ? 'pin' : c.type === 'ngbe' || c.type === 'toponimo' ? 'mountain' : 'pin';
  const [first, ...rest] = c.address.split(',');
  const base = title(first!.trim());
  const main = c.portalNumber && !new RegExp(`\\b${c.portalNumber}$`).test(base) ? `${base} ${c.portalNumber}` : base;
  const sub = [rest.join(',').trim(), c.type === 'Municipio' ? c.province : c.muni !== first?.trim() ? c.muni : c.province].filter(Boolean).map((x) => title(x!)).join(', ');
  return { main, sub, kind };
}

export async function resolve(c: Candidate, signal?: AbortSignal): Promise<Place> {
  const d = describe(c);
  const short = c.type === 'Municipio' || c.type === 'poblacion' ? d.main : `${d.main}, ${title(c.muni ?? c.poblacion ?? '')}`.replace(/, $/, '');
  if (c.lat && c.lng) return { label: `${d.main}${d.sub ? `, ${d.sub}` : ''}`, short, lon: c.lng, lat: c.lat };
  const p = new URLSearchParams({ id: c.id, type: c.type });
  if (c.portalNumber) p.set('portal', String(c.portalNumber));
  const r = await fetch(`${API}/find?${p}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const f = (await r.json()) as Candidate;
  const pts = f.geom ? wktCoords(f.geom) : [];
  if (f.lat && f.lng && !pts.length) pts.push([f.lng, f.lat]);
  if (!pts.length) throw new Error('no geometry');
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const lon = f.lng || (bbox[0] + bbox[2]) / 2;
  const lat = f.lat || (bbox[1] + bbox[3]) / 2;
  return { label: `${d.main}${d.sub ? `, ${d.sub}` : ''}`, short, lon, lat, bbox: bbox[0] === bbox[2] && bbox[1] === bbox[3] ? undefined : bbox };
}

/** Name of the place at a point (municipality), for titles and exports. */
export async function placeName(lon: number, lat: number, signal?: AbortSignal): Promise<string> {
  try {
    const r = await fetch(`${API}/reverseGeocode?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`, { signal });
    if (!r.ok) return '';
    const j = (await r.json()) as Candidate | null;
    return j?.muni ? title(j.muni) : '';
  } catch {
    return '';
  }
}

/** The search box with its suggestion list. */
export class SearchBox {
  readonly el: HTMLFormElement;
  readonly input: HTMLInputElement;
  private list: HTMLUListElement;
  private items: Candidate[] = [];
  private active = -1;
  private ctl: AbortController | null = null;
  private timer = 0;
  private placeholder: string;

  private onPick: (p: Place) => void;
  /** Extra suggestions from our own data (roads), shown first. */
  local: (q: string) => Candidate[] = () => [];

  constructor(onPick: (p: Place) => void, placeholder = 'Busca un lugar o una carretera…') {
    this.onPick = onPick;
    this.placeholder = placeholder;
    this.el = document.createElement('form');
    this.el.className = 'search';
    this.el.setAttribute('role', 'search');
    const uid = `q${Math.random().toString(36).slice(2, 7)}`;
    this.el.innerHTML = `<label class="sr-only" for="${uid}">${t('Buscar una dirección')}</label>
      <input id="${uid}" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${uid}-list"
        placeholder="${this.placeholder}" />
      <button type="button" class="icon-btn search-clear" aria-label="${t('Borrar')}" hidden></button>
      <ul id="${uid}-list" class="search-list" role="listbox" hidden></ul>`;
    this.el.prepend(icon('search', 18));
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('ul')!;
    const clear = this.el.querySelector<HTMLButtonElement>('.search-clear')!;
    clear.append(icon('x', 16));
    clear.addEventListener('click', () => {
      this.input.value = '';
      clear.hidden = true;
      this.close();
      this.input.focus();
    });
    this.input.addEventListener('input', () => {
      clear.hidden = !this.input.value;
      clearTimeout(this.timer);
      const q = this.input.value.trim();
      if (q.length < 2) return this.close();
      this.timer = window.setTimeout(() => void this.suggest(q), 220);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.items.length) return;
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length;
        this.renderActive();
      } else if (e.key === 'Escape') this.close();
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.list.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
      if (li) void this.pick(this.items[Number(li.dataset.i)]!);
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
  }

  /** Enter: the highlighted suggestion, or the best match for the text. */
  async submit(q = this.input.value.trim()): Promise<boolean> {
    if (!q) return false;
    if (this.active >= 0 && this.items[this.active]) {
      await this.pick(this.items[this.active]!);
      return true;
    }
    try {
      const list = this.items.length && q === this.input.value.trim() ? this.items : await candidates(q);
      if (!list.length) {
        this.message(t('No encontramos «{q}». Prueba con el municipio.', { q }));
        return false;
      }
      await this.pick(list[0]!);
      return true;
    } catch {
      this.message(t('El buscador no responde. Inténtalo de nuevo.'));
      return false;
    }
  }

  private async suggest(q: string): Promise<void> {
    this.ctl?.abort();
    this.ctl = new AbortController();
    this.el.classList.add('busy');
    try {
      const mine = this.local(q);
      this.items = [...mine, ...(await candidates(q, this.ctl.signal).catch((e: Error) => { if (mine.length) return []; throw e; }))].slice(0, 8);
      this.active = -1;
      if (!this.items.length) return this.message(t('Sin resultados'));
      this.list.replaceChildren(
        ...this.items.map((c, i) => {
          const d = describe(c);
          const li = document.createElement('li');
          li.id = `${this.input.id}-${i}`;
          li.dataset.i = String(i);
          li.setAttribute('role', 'option');
          const txt = document.createElement('span');
          txt.innerHTML = '<b></b><small></small>';
          txt.firstElementChild!.textContent = d.main;
          txt.lastElementChild!.textContent = d.sub;
          li.append(icon(d.kind, 16), txt);
          return li;
        }),
      );
      this.open();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.message(t('El buscador no responde. Inténtalo de nuevo.'));
    } finally {
      this.el.classList.remove('busy');
    }
  }

  private message(text: string): void {
    this.items = [];
    const li = document.createElement('li');
    li.className = 'msg';
    li.textContent = text;
    this.list.replaceChildren(li);
    this.open();
  }

  private renderActive(): void {
    [...this.list.children].forEach((li, i) => li.classList.toggle('active', i === this.active));
    this.input.setAttribute('aria-activedescendant', this.active >= 0 ? `${this.input.id}-${this.active}` : '');
  }

  private async pick(c: Candidate): Promise<void> {
    this.close();
    this.el.classList.add('busy');
    try {
      const p = c.type === 'local' ? { label: c.address, short: c.address, lon: c.lng, lat: c.lat, bbox: c.bbox } : await resolve(c);
      this.input.value = describe(c).main;
      this.input.blur();
      this.onPick(p);
    } catch {
      this.message(t('No pudimos situar ese resultado. Prueba con otro.'));
    } finally {
      this.el.classList.remove('busy');
    }
  }

  private open(): void {
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    this.list.hidden = true;
    this.active = -1;
    this.input.setAttribute('aria-expanded', 'false');
  }
}
