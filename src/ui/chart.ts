// Small dependency-free SVG line chart (step or smooth) with axes, crosshair and tooltip.
export interface Series { label: string; color: string; points: [number, number][]; step?: boolean }

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

function niceTicks(min: number, max: number, n = 4): number[] {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function lineChart(series: Series[], opts: { height?: number; yFormat?: (v: number) => string; xFormat?: (t: number) => string; tipX?: (t: number) => string; title?: string } = {}): HTMLElement {
  const wrap = document.createElement('figure');
  wrap.className = 'chart';
  const W = 640;
  const H = opts.height ?? 220;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    wrap.innerHTML = '<p class="muted">Sin datos todavía.</p>';
    return wrap;
  }
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const yp = (y1 - y0) * 0.08 || 0.05;
  y0 -= yp;
  y1 += yp;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.title ?? series.map((s) => s.label).join(', ') });
  const fy = opts.yFormat ?? ((v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 }));
  for (const t of niceTicks(y0, y1)) {
    el('line', { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), class: 'grid' }, svg);
    el('text', { x: pad.l - 6, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fy(t);
  }
  const fx = opts.xFormat ?? ((t: number) => new Date(t).getFullYear().toString());
  const span = x1 - x0;
  const nx = Math.min(6, Math.max(2, Math.round(W / 120)));
  for (let i = 0; i <= nx; i++) {
    const t = x0 + (span * i) / nx;
    el('text', { x: sx(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle', class: 'tick' }, svg).textContent = fx(t);
  }
  for (const s of series) {
    if (!s.points.length) continue;
    let d = '';
    s.points.forEach(([x, y], i) => {
      if (i === 0) d += `M${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      else if (s.step) d += `H${sx(x).toFixed(1)}V${sy(y).toFixed(1)}`;
      else d += `L${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    });
    if (s.step) d += `H${sx(x1).toFixed(1)}`;
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, svg);
  }
  const cross = el('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' }, svg);
  const dots = series.map((s) => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  wrap.append(svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);
  const at = (s: Series, t: number): [number, number] | undefined => {
    let best: [number, number] | undefined;
    for (const p of s.points) {
      if (p[0] <= t) best = p;
      else break;
    }
    return best ?? s.points[0];
  };
  const move = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const t = x0 + ((x - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    if (t < x0 || t > x1) return leave();
    cross.setAttribute('x1', String(sx(t)));
    cross.setAttribute('x2', String(sx(t)));
    cross.setAttribute('visibility', 'visible');
    const rows: string[] = [];
    series.forEach((s, i) => {
      const p = at(s, t);
      if (!p) return;
      dots[i]!.setAttribute('cx', String(sx(s.step ? t : p[0])));
      dots[i]!.setAttribute('cy', String(sy(p[1])));
      dots[i]!.setAttribute('visibility', 'visible');
      rows.push(`<span><i style="background:${s.color}"></i>${s.label}: <b>${fy(p[1])}</b></span>`);
    });
    tip.innerHTML = `<strong>${(opts.tipX ?? ((v: number) => new Date(v).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })))(t)}</strong>${rows.join('')}`;
    tip.hidden = false;
    const left = ((sx(t) / W) * r.width);
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
  };
  const leave = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', (e) => move(e.clientX));
  svg.addEventListener('pointerleave', leave);
  if (series.length > 1) {
    const legend = document.createElement('figcaption');
    legend.className = 'chart-legend';
    legend.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
    wrap.append(legend);
  }
  return wrap;
}

export function bars(rows: { label: string; value: number; note?: string; color?: string }[], fmt: (v: number) => string, opts: { min?: number } = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'bars';
  const vals = rows.map((r) => r.value);
  const lo = opts.min ?? Math.min(...vals) * 0.98;
  const hi = Math.max(...vals);
  for (const r of rows) {
    const w = hi > lo ? ((r.value - lo) / (hi - lo)) * 100 : 100;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `<span class="bar-label">${r.label}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, w).toFixed(1)}%;${r.color ? `background:${r.color}` : ''}"></span></span><span class="bar-value">${fmt(r.value)}${r.note ? `<small>${r.note}</small>` : ''}</span>`;
    wrap.append(row);
  }
  return wrap;
}
