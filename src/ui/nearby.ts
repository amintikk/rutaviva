// "Gasolineras cerca": the stations around you (or the map centre), open now, by price or distance.
import { esc, FUEL_LABEL, nf, price, titleCase, type Station } from '../data.ts';
import type { Ctx } from './details.ts';
import { openState } from './hours.ts';
import { iconSvg } from './icons.ts';

type Sort = 'price' | 'dist';
const LS = 'rutaviva-nearby';

function distKm(a: [number, number], b: [number, number]): number {
  const kx = Math.cos((a[1] * Math.PI) / 180) * 111.32;
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57);
}

function prefs(): { sort: Sort; radius: number; open: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (v && typeof v === 'object') return { sort: v.sort === 'dist' ? 'dist' : 'price', radius: [3, 10, 25].includes(v.radius) ? v.radius : 10, open: v.open !== false };
  } catch { /* defaults */ }
  return { sort: 'price', radius: 10, open: true };
}

export async function nearbyFuel(ctx: Ctx): Promise<void> {
  const el = document.createElement('div');
  el.className = 'detail nearby';
  el.innerHTML = `<p class="muted loading">${iconSvg('loader', 16)} Buscando tu ubicación…</p>`;
  ctx.sheet.show('Gasolineras cerca', '', el);
  const stamp = ctx.sheet.stamp;
  const [origin, fromGps] = await new Promise<[[number, number], boolean]>((resolve) => {
    const c = ctx.map.getCenter();
    const fallback: [[number, number], boolean] = [[c.lng, c.lat], false];
    if (!navigator.geolocation) return resolve(fallback);
    navigator.geolocation.getCurrentPosition((p) => resolve([[p.coords.longitude, p.coords.latitude], true]), () => resolve(fallback), { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
  });
  if (!ctx.layers.get('fuel')) await ctx.layers.load('fuel').catch(() => {});
  if (ctx.sheet.stamp !== stamp) return;
  const st = prefs();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch { /* ignore */ } };
  const head = document.createElement('div');
  head.className = 'nearby-head';
  const seg = (items: [string, string][], cur: () => string, set: (v: string) => void) => {
    const g = document.createElement('div');
    g.className = 'seg';
    for (const [v, label] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(cur() === v));
      b.addEventListener('click', () => {
        set(v);
        g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        save();
        draw();
      });
      g.append(b);
    }
    return g;
  };
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'toggle-chip';
  openBtn.setAttribute('aria-pressed', String(st.open));
  openBtn.textContent = 'Abiertas ahora';
  openBtn.addEventListener('click', () => {
    st.open = !st.open;
    openBtn.setAttribute('aria-pressed', String(st.open));
    save();
    draw();
  });
  head.append(
    seg([['price', 'Más barata'], ['dist', 'Más cerca']], () => st.sort, (v) => { st.sort = v as Sort; }),
    seg([['3', '3 km'], ['10', '10 km'], ['25', '25 km']], () => String(st.radius), (v) => { st.radius = Number(v); }),
    openBtn,
  );
  const list = document.createElement('ul');
  list.className = 'list';
  const note = document.createElement('p');
  note.className = 'muted small';
  el.replaceChildren(head, list, note);
  ctx.map.easeTo({ center: origin, zoom: Math.max(ctx.map.getZoom(), 12), duration: 700 });

  function draw(): void {
    const code = ctx.layers.fuel;
    const key = `p_${code}` as const;
    const now = new Date();
    const all = ctx.layers.features('fuel').map((f) => {
      const p = f.properties as Station;
      const pt = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      return { p, pt, d: distKm(origin, pt), v: p[key], o: openState(p.hours, p.prov, now) };
    }).filter((x) => x.d <= st.radius && typeof x.v === 'number' && x.p.public);
    const shown = all.filter((x) => !st.open || x.o.open !== false);
    shown.sort((a, b) => (st.sort === 'price' ? a.v! - b.v! || a.d - b.d : a.d - b.d));
    const vals = all.map((x) => x.v!).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)] ?? 0;
    list.replaceChildren();
    for (const x of shown.slice(0, 40)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const save50 = median && x.v! < median ? `−${nf.format(Math.round((median - x.v!) * 50 * 10) / 10)} € en 50 l` : '';
      b.innerHTML = `<span class="price-chip">${price(x.v)}</span><span><b>${esc(x.p.brand || 'Gasolinera')}</b><br><small>${esc(titleCase(x.p.muni))} · ${nf.format(Math.round(x.d * 10) / 10)} km${x.o.text ? ` · <span class="${x.o.open ? 'open-now' : 'closed-now'}">${esc(x.o.text)}</span>` : ''}</small></span>
        <small class="muted">${save50}</small>`;
      b.addEventListener('click', () => {
        ctx.map.flyTo({ center: x.pt, zoom: 15 });
        ctx.open('fuel', x.p as unknown as Record<string, unknown>, x.pt[0], x.pt[1], true);
      });
      li.append(b);
      list.append(li);
    }
    if (!shown.length) list.innerHTML = `<li class="muted">No hay gasolineras ${st.open ? 'abiertas ahora ' : ''}con ${esc(FUEL_LABEL[code]?.toLowerCase() ?? code)} a menos de ${st.radius} km.</li>`;
    const closed = all.length - all.filter((x) => x.o.open !== false).length;
    ctx.sheet.show('Gasolineras cerca', `${FUEL_LABEL[code] ?? code} · ${fromGps ? 'desde tu ubicación' : 'desde el centro del mapa'}`, el);
    note.textContent = `${nf.format(all.length)} gasolineras de venta al público a menos de ${st.radius} km${st.open && closed ? `; ${nf.format(closed)} cerradas ahora según su horario publicado` : ''}. Precios del Ministerio, actualizados cada media hora.`;
  }
  draw();
}
