// Content pages: fuel history, charger reliability, low-emission zones, roads.
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/pages.css';
import { ago, CATS, esc, km, live, nf, price, titleCase, V16_COLOR, type Cat, type FC, type Incident, type Zone } from './data.ts';
import { bars, lineChart } from './ui/chart.ts';
import { initConsent } from './ui/consent.ts';
import { icon, iconSvg, type IconName } from './ui/icons.ts';
import { isDark, setTheme } from './ui/theme.ts';

const main = document.querySelector<HTMLElement>('main')!;
const kind = main.dataset.page;

const themeBtn = document.querySelector<HTMLButtonElement>('.theme-btn');
if (themeBtn) {
  const paint = () => themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon', 19));
  paint();
  themeBtn.addEventListener('click', () => {
    setTheme(isDark() ? 'light' : 'dark');
    paint();
  });
}
initConsent();

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const fmtEur = (v: number) => v.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// ---------------------------------------------------------------- gasolineras

interface Trends { last_day: string; national: Record<string, [string, number, number][]>; weekday: Record<string, number[]>; brands: Record<string, [string, number, number][]>; provinces: Record<string, [string, number, number][]> }

async function fuelPage(): Promise<void> {
  let tr: Trends;
  try {
    tr = await live<Trends>('fuel-trends', 3600);
  } catch {
    $('#national')!.innerHTML = '<p class="muted">Estamos reconstruyendo la historia de precios desde 2007. Vuelve en unas horas.</p>';
    return;
  }
  const colors: Record<string, string> = { g95: '#34c759', diesel: '#0a84ff', g98: '#af52de', glp: '#ff9500' };
  const labels: Record<string, string> = { g95: 'Gasolina 95', diesel: 'Diésel', g98: 'Gasolina 98', glp: 'GLP' };
  const ranges: [string, number][] = [['1 año', 365], ['5 años', 5 * 365], ['Todo', 99999]];
  const seg = $('#range')!;
  const draw = (days: number) => {
    const since = Date.now() - days * 864e5;
    const series = (['g95', 'diesel', 'g98'] as const).filter((c) => tr.national[c]).map((c) => {
      const pts = tr.national[c]!.filter((p) => p[2] >= 300).map((p) => [Date.parse(p[0]), p[1]] as [number, number]).filter((p) => p[0] >= since);
      // Weekly points keep the long chart light.
      const step = days > 2000 ? 7 : days > 400 ? 2 : 1;
      return { label: labels[c]!, color: colors[c]!, points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1) };
    });
    const first = series[0]?.points[0];
    const yFormat = (v: number) => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const span = first ? Date.now() - first[0] : 0;
    const fmtX = (t: number) => (span < 60 * 864e5 ? new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : span < 800 * 864e5 ? new Date(t).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : String(new Date(t).getFullYear()));
    $('#national')!.replaceChildren(lineChart(series, { height: 280, yFormat, xFormat: fmtX }));
    const last = series.map((s) => `${s.label} ${price(s.points[s.points.length - 1]?.[1])}`).join(' · ');
    $('#national-note')!.textContent = `${last} (mediana de todas las gasolineras, ${new Date(tr.last_day).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}).${first ? ` Datos desde ${new Date(first[0]).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}.` : ''}`;
  };
  for (const [label, days] of ranges) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(days === 5 * 365));
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw(days);
    });
    seg.append(b);
  }
  draw(5 * 365);
  const DOW = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const wk = tr.weekday.g95;
  const histDays = tr.national.g95?.length ?? 0;
  if (wk && histDays >= 90 && wk.some((v) => v !== 0)) {
    const rows = wk.map((v, i) => ({ label: DOW[i]!, value: v * 100, color: v <= 0 ? '#34c759' : '#ff9500' }));
    $('#weekday')!.replaceChildren(bars(rows, (v) => `${v > 0 ? '+' : ''}${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} cént.`, { min: Math.min(...rows.map((r) => r.value), 0) }));
    const best = rows.reduce((a, b) => (b.value < a.value ? b : a));
    const worst = rows.reduce((a, b) => (b.value > a.value ? b : a));
    $('#weekday')!.insertAdjacentHTML('beforeend', `<p class="callout">${iconSvg('down', 18)}<span>Lo más barato suele ser el <b>${best.label.toLowerCase()}</b>; lo más caro, el <b>${worst.label.toLowerCase()}</b>: unos ${Math.abs(worst.value - best.value).toLocaleString('es-ES', { maximumFractionDigits: 1 })} céntimos por litro de diferencia, ${Math.abs((worst.value - best.value) * 0.5).toLocaleString('es-ES', { maximumFractionDigits: 1 })} € en un depósito de 50 litros.</span></p>`);
  } else $('#weekday')!.innerHTML = `<p class="muted">Estamos descargando la historia completa de precios (${nf.format(histDays)} días de momento). En cuanto haya tres meses aparecerá aquí.</p>`;
  const br = tr.brands.g95 ?? [];
  if (br.length) {
    const sorted = [...br].sort((a, b) => a[1] - b[1]);
    const pick = [...sorted.slice(0, 7), ...sorted.slice(-5)].filter((x, i, arr) => arr.indexOf(x) === i);
    $('#brands')!.replaceChildren(bars(pick.map(([b, v, n]) => ({ label: b.length <= 3 ? b.toUpperCase() : titleCase(b), value: v, note: ` · ${n} est.`, color: v <= sorted[Math.floor(sorted.length / 2)]![1] ? '#34c759' : '#ff9500' })), fmtEur));
  }
  const pv95 = new Map((tr.provinces.g95 ?? []).map(([p, v]) => [p, v]));
  const pvD = new Map((tr.provinces.diesel ?? []).map(([p, v]) => [p, v]));
  const provs = [...pv95.keys()].sort((a, b) => (pv95.get(a)! - pv95.get(b)!));
  $('#provinces')!.innerHTML = `<div class="table-wrap tall"><table class="plain"><thead><tr><th>Provincia</th><th>Gasolina 95</th><th>Diésel</th></tr></thead><tbody>${provs.map((p) => `<tr><td>${esc(titleCase(p))}</td><td>${price(pv95.get(p))}</td><td>${price(pvD.get(p))}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- recarga

interface EvSummary { generated: string; stations: number; points: number; fast: number; h24: number; bands: { band: string; stations: number; points: number }[]; provinces: { prov: string; stations: number; points: number; fast: number }[]; operators: { op: string; stations: number; points: number; fast: number }[]; conns: [string, number][] }

/** "IBERDROLA CLIENTES S.A.U" -> "Iberdrola Clientes". */
function opName(s: string): string {
  const t = s.replace(/[,.]?\s*\b(S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?|SLU|SAU|SL|SA|SRL)\.?$/i, '').replace(/[,\s]+$/, '').trim();
  return t === t.toUpperCase() ? titleCase(t) : t;
}
/** "Balears, Illes" -> "Illes Balears". */
const provLabel = (p: string) => { const m = /^(.*?),\s*(.+)$/.exec(p); return titleCase(m ? `${m[2]} ${m[1]}` : p); };
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function evNetwork(): Promise<void> {
  let s: EvSummary;
  try {
    s = await live<EvSummary>('ev-summary', 3600);
  } catch {
    $('#ev-net')!.innerHTML = '<p class="muted">No se pudo cargar la red de recarga.</p>';
    return;
  }
  const share = (a: number, b: number) => `${Math.round((a / b) * 100)} %`;
  $('#ev-net')!.innerHTML = `<div class="stat"><b>${nf.format(s.stations)}</b><span>estaciones públicas</span></div>
    <div class="stat"><b>${nf.format(s.points)}</b><span>puntos de recarga</span></div>
    <div class="stat"><b style="color:#0a84ff">${nf.format(s.fast)}</b><span>rápidas, de 50 kW o más (${share(s.fast, s.stations)})</span></div>
    <div class="stat"><b style="color:#1fa34a">${nf.format(s.h24)}</b><span>abiertas las 24 horas</span></div>`;
  const bandColor = ['#5e5ce6', '#0a84ff', '#30b0c7', '#8e8e93'];
  const BAND = ['150 kW o más', '50 a 149 kW', '22 a 49 kW', 'Menos de 22 kW'];
  $('#ev-bands')!.replaceChildren(bars(s.bands.map((b, i) => ({ label: BAND[i] ?? b.band, value: b.stations, note: ` · ${nf.format(b.points)} puntos`, color: bandColor[i] })), (v) => nf.format(v), { min: 0 }));
  const total = s.conns.reduce((a, [, n]) => a + n, 0);
  $('#ev-conns')!.replaceChildren(bars(s.conns.slice(0, 6).map(([c, n]) => ({ label: c, value: n, note: ` · ${share(n, total)}`, color: '#34c759' })), (v) => nf.format(v), { min: 0 }));
  $('#ev-opsnet')!.replaceChildren(bars(s.operators.slice(0, 12).map((o) => ({ label: opName(o.op), value: o.points, note: ` · ${nf.format(o.fast)} rápidas`, color: '#0a84ff' })), (v) => `${nf.format(v)} puntos`, { min: 0 }));
  const rows = s.provinces.map((p) => `<tr data-prov="${esc(fold(provLabel(p.prov)))}"><td>${esc(provLabel(p.prov))}</td><td>${nf.format(p.stations)}</td><td>${nf.format(p.points)}</td><td>${nf.format(p.fast)}</td></tr>`);
  $('#ev-provs')!.innerHTML = `<div class="table-wrap tall"><table class="plain"><thead><tr><th>Provincia</th><th>Estaciones</th><th>Puntos</th><th>Rápidas</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <p class="muted small">Datos del Punto de Acceso Nacional (MITERD), actualizados ${esc(ago(s.generated))}.</p>`;
  const f = document.querySelector<HTMLInputElement>('#ev-prov-filter');
  f?.addEventListener('input', () => {
    const q = fold(f.value.trim());
    document.querySelectorAll<HTMLElement>('#ev-provs tr[data-prov]').forEach((tr) => { tr.hidden = !!q && !tr.dataset.prov!.includes(q); });
  });
}

interface Ranking { day: string; total: number; broken: number; available: number; busy: number; operators: { name: string; n: number; broken: number; free: number; busy: number }[]; prices: { band: string; n: number; p25: number; median: number; p75: number }[]; history: [string, number, number][] }

async function evPage(): Promise<void> {
  void evNetwork();
  let r: Ranking;
  try {
    r = await live<Ranking>('ev-ranking', 3600);
    if (!r.total) throw new Error();
  } catch {
    $('#ev-stats')!.outerHTML = `<section class="card soon">${iconSvg('clock', 22)}<div><h3>Todavía no tenemos el primer recorrido completo</h3><p class="muted">El estado de cada punto (libre, en uso o averiado) y su precio llegan de REVE, el mapa oficial de Red Eléctrica. En cuanto termine el primer recorrido nocturno aparecerán aquí el porcentaje de puntos averiados, los operadores con más averías y lo que cuesta cargar.</p></div></section>`;
    document.querySelectorAll('.ev-extra').forEach((el) => el.remove());
    return;
  }
  const pct = (a: number, b: number) => `${((a / b) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
  $('#ev-stats')!.innerHTML = `<div class="stat"><b>${nf.format(r.total)}</b><span>ubicaciones con datos en tiempo real</span></div>
    <div class="stat"><b style="color:#1fa34a">${pct(r.available, r.total)}</b><span>libres</span></div>
    <div class="stat"><b style="color:#0a84ff">${pct(r.busy, r.total)}</b><span>en uso</span></div>
    <div class="stat"><b style="color:#ff3b30">${pct(r.broken, r.total)}</b><span>averiadas (${nf.format(r.broken)})</span></div>`;
  const ops = r.operators.slice(0, 25);
  $('#ev-ops')!.replaceChildren(bars(ops.map((o) => ({ label: o.name, value: (o.broken / o.n) * 100, note: ` · ${o.broken}/${o.n}`, color: '#ff3b30' })), (v) => `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`, { min: 0 }));
  if (r.prices.length) {
    $('#ev-prices')!.innerHTML = `<div class="table-wrap"><table class="plain"><thead><tr><th>Potencia</th><th>Precio típico</th><th>La mitad, entre</th><th>Puntos</th></tr></thead><tbody>${r.prices.map((p) => `<tr><td>${esc(p.band)}</td><td><b>${fmtEur(p.median)} €/kWh</b></td><td>${fmtEur(p.p25)} y ${fmtEur(p.p75)} €</td><td>${nf.format(p.n)}</td></tr>`).join('')}</tbody></table></div>
      <p class="callout">${iconSvg('zap', 18)}<span>Con un consumo de 17 kWh/100 km, cargar en un punto ${esc(r.prices[r.prices.length - 1]!.band.toLowerCase())} cuesta unos <b>${(r.prices[r.prices.length - 1]!.median * 17).toLocaleString('es-ES', { maximumFractionDigits: 2 })} € cada 100 km</b>.</span></p>`;
  } else $('#ev-prices')!.innerHTML = '<p class="muted">Aún reuniendo precios.</p>';
  if (r.history.length > 1) {
    $('#ev-hist')!.replaceChildren(lineChart([{ label: 'Averiadas', color: '#ff3b30', points: r.history.map(([d, n, b]) => [Date.parse(d), (b / n) * 100]) }], { height: 200, yFormat: (v) => `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`, xFormat: (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }));
  } else $('#ev-hist')!.innerHTML = `<p class="muted">Primer recorrido: ${esc(new Date(r.day).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))}. La evolución aparecerá con los días.</p>`;
}

// ---------------------------------------------------------------- ZBE

const STICKERS: [string, string, string][] = [['0', 'CERO', '#1d6fd1'], ['ECO', 'ECO', '#1f9e6e'], ['C', 'C', '#2fa84f'], ['B', 'B', '#e7b416'], ['A', 'Sin etiqueta', '#8e8e93']];

async function zbePage(): Promise<void> {
  const fc = await live<FC<Zone>>('zbe', 3600);
  const zones = fc.features.map((f) => f.properties).sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  const seg = $('#sticker')!;
  let mine = 'B';
  try { mine = localStorage.getItem('rutaviva-sticker') ?? 'B'; } catch { /* ignore */ }
  const render = () => {
    const rows = zones.map((z) => {
      const banned = z.banned === '?' ? null : z.banned.split(',').filter(Boolean);
      const state = banned === null ? ['unk', 'Consulta las normas'] : banned.includes(mine) ? ['no', 'Restringido'] : ['ok', 'Puedes entrar'];
      return `<li class="zbe-row ${state[0]}"><span class="zbe-state">${state[0] === 'ok' ? iconSvg('dot', 16) : state[0] === 'no' ? iconSvg('ban', 16) : iconSvg('info', 16)} ${state[1]}</span>
        <span><b>${esc(z.city)}</b><small>${esc(z.name)}${z.periods ? ` · ${esc(z.periods)}` : ''}</small></span>
        ${z.url ? `<a href="${esc(z.url)}" target="_blank" rel="noopener" aria-label="Normas de ${esc(z.city)}">${iconSvg('external', 16)}</a>` : '<span></span>'}</li>`;
    });
    const ok = zones.filter((z) => z.banned !== '?' && !z.banned.split(',').includes(mine)).length;
    $('#zbe-list')!.innerHTML = `<p class="callout">${iconSvg('leaf', 18)}<span>Con etiqueta <b>${esc(STICKERS.find((s) => s[0] === mine)![1])}</b> puedes entrar en <b>${ok} de ${zones.length}</b> zonas publicadas.</span></p><ul class="zbe-list">${rows.join('')}</ul>`;
  };
  for (const [code, label, color] of STICKERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<i style="background:${color}"></i>${label}`;
    b.setAttribute('aria-pressed', String(code === mine));
    b.addEventListener('click', () => {
      mine = code;
      try { localStorage.setItem('rutaviva-sticker', code); } catch { /* ignore */ }
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    });
    seg.append(b);
  }
  render();
}

// ---------------------------------------------------------------- roads

const normRoad = (r: unknown) => String(r ?? '').toUpperCase().replace(/\s+/g, '').replace(/^([A-Z]+)(\d)/, '$1-$2');
type Look = { label: string; plural: string; color: string; icon: IconName; rank: number };
/** Category of an incident, or a V16 beacon (a stopped vehicle that switched one on). */
const look = (p: Incident): Look => (p.v16 ? { label: 'Baliza V16 activada', plural: 'Balizas V16', color: V16_COLOR, icon: 'siren', rank: 5 } : CATS[p.cat as Cat] ?? CATS.otro);
function tally(list: Incident[]): { n: number; l: Look }[] {
  const m = new Map<string, { n: number; l: Look }>();
  for (const p of list) {
    const l = look(p);
    const c = m.get(l.label) ?? { n: 0, l };
    c.n++;
    m.set(l.label, c);
  }
  return [...m.values()].sort((a, b) => a.l.rank - b.l.rank);
}

async function roadPage(): Promise<void> {
  const box = $('#road-live');
  const road = box?.dataset.road;
  if (box && road) {
    const now = $('#road-now');
    try {
      const fc = await live<FC<Incident>>('incidents', 60);
      const list = fc.features.filter((f) => normRoad(f.properties.road) === road)
        .sort((a, b) => look(a.properties).rank - look(b.properties).rank || String(b.properties.start ?? '').localeCompare(String(a.properties.start ?? '')));
      if (now) now.textContent = nf.format(list.length);
      const summary = tally(list.map((f) => f.properties)).map(({ n, l }) => `<span class="cat-pill" style="--c:${l.color}">${iconSvg(l.icon, 14)}<b>${n}</b> ${esc(n === 1 ? l.label : l.plural)}</span>`).join('');
      const rows = list.map((f, i) => {
        const p = f.properties;
        const l = look(p);
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        return `<li${i >= 8 ? ' class="extra"' : ''}><span class="mini-badge" style="--c:${l.color}">${iconSvg(l.icon, 15, '#fff', 2.2)}</span><span class="grow"><b>${esc(l.label)}</b> ${p.km != null ? `<span class="muted">${esc(km(p.km))}</span>` : ''}<br><small>${esc(titleCase(p.muni) || titleCase(p.prov))} · ${esc(ago(p.start))}</small></span><a class="go" href="/?ver=incident:${encodeURIComponent(p.id)}#mapa=13/${lat.toFixed(5)}/${lon.toFixed(5)}" aria-label="Ver en el mapa">${iconSvg('chevronRight', 18)}</a></li>`;
      });
      box.innerHTML = `<div class="card-head"><h2>Ahora en la ${esc(road)}</h2><span class="muted small">Actualizado ${esc(ago(fc.generated))}</span></div>
        ${rows.length ? `<div class="cat-pills">${summary}</div><ul class="inc-list${rows.length > 8 ? ' folded' : ''}">${rows.join('')}</ul>${rows.length > 8 ? `<button class="btn ghost more-btn" type="button" data-unfold>Ver los ${rows.length} avisos</button>` : ''}`
          : `<p class="ok-msg">${iconSvg('check', 18)} Sin avisos publicados ahora mismo.</p>`}`;
    } catch {
      if (now) now.textContent = '—';
      box.innerHTML = `<h2>Ahora en la ${esc(road)}</h2><p class="muted">No se pudo cargar el estado.</p>`;
    }
  }
  // Refresh the visible camera images every 2 minutes while the page is open.
  setInterval(() => {
    document.querySelectorAll<HTMLImageElement>('.cam-grid img').forEach((img) => {
      const r = img.getBoundingClientRect();
      if (r.height && r.bottom > 0 && r.top < innerHeight) img.src = img.src.replace(/(\?t=\d+)?$/, `?t=${Date.now()}`);
    });
  }, 120000);
  document.querySelectorAll<HTMLImageElement>('.cam-grid img').forEach((img) => img.addEventListener('error', () => img.closest('figure')?.classList.add('off')));
}

// "Ver todos": a folded list or grid opens in place.
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-unfold]');
  if (!b) return;
  b.previousElementSibling?.classList.remove('folded');
  b.remove();
});

async function roadsPage(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#road-filter');
  const cards = [...document.querySelectorAll<HTMLAnchorElement>('.road-list a')];
  input?.addEventListener('input', () => {
    const q = normRoad(input.value).replace(/-/g, '');
    for (const a of cards) a.hidden = !!q && !a.dataset.road!.replace(/-/g, '').includes(q);
    document.querySelectorAll<HTMLElement>('.road-group').forEach((g) => { g.hidden = !g.querySelector('a:not([hidden])'); });
  });
  try {
    const fc = await live<FC<Incident>>('incidents', 120);
    const by = new Map<string, Incident[]>();
    for (const f of fc.features) {
      const r = normRoad(f.properties.road);
      by.set(r, [...(by.get(r) ?? []), f.properties]);
    }
    // Serious ones first: accidents, cuts, queues and snow count more than roadworks.
    const serious = (l: Incident[]) => l.filter((p) => ['accidente', 'cerrada', 'retencion', 'nieve'].includes(p.cat)).length;
    for (const a of cards) {
      const l = by.get(a.dataset.road!) ?? [];
      if (!l.length) continue;
      const i = a.querySelector<HTMLElement>('.live-n')!;
      i.hidden = false;
      i.textContent = `${l.length} ${l.length === 1 ? 'aviso' : 'avisos'}`;
      i.classList.toggle('hot', serious(l) > 0);
    }
    const known = new Set(cards.map((a) => a.dataset.road!));
    const top = [...by.entries()].filter(([r]) => known.has(r)).map(([r, l]) => ({ r, l, s: serious(l) })).sort((a, b) => b.s - a.s || b.l.length - a.l.length).slice(0, 6);
    const box = $('#roads-now');
    if (box && top.length) {
      box.hidden = false;
      $('#roads-now-note')!.textContent = `Actualizado ${ago(fc.generated)}`;
      box.querySelector('.now-list')!.innerHTML = top.map(({ r, l }) => {
        const a = cards.find((c) => c.dataset.road === r)!;
        return `<a href="${a.getAttribute('href')}"><span class="now-top">${a.querySelector('.road-shield')!.outerHTML}<span class="muted small">${l.length} ${l.length === 1 ? 'aviso' : 'avisos'}</span></span><span class="cat-pills">${tally(l).slice(0, 4).map(({ n, l: k }) => `<span class="cat-pill" title="${esc(n === 1 ? k.label : k.plural)}" style="--c:${k.color}">${iconSvg(k.icon, 13)}<b>${n}</b></span>`).join('')}</span></a>`;
      }).join('');
    }
  } catch { /* the list works without the live counts */ }
}

if (kind === 'fuel') void fuelPage();
else if (kind === 'ev') void evPage();
else if (kind === 'zbe') void zbePage();
else if (kind === 'road') void roadPage();
else if (kind === 'roads') void roadsPage();
