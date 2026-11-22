// Detail views for every kind of map feature, shown in the sheet.
import type { Map as MlMap } from 'maplibre-gl';
import {
  ago, CATS, esc, FUEL_LABEL, FUELS, km, live, nf, price, SRC, titleCase, when, WHAT,
  TRAFFIC_STATE, type Alert, type Camera, type Cat, type Charger, type Congestion, type FC, type Incident, type MobileZone, type Panel, type Quake, type Radar,
  type SourceStatus, type Station, type Zone,
} from '../data.ts';
import type { Layers } from '../map/layers.ts';
import { lineChart } from './chart.ts';
import { openState } from './hours.ts';
import { icon, iconSvg, type IconName } from './icons.ts';
import type { Sheet } from './sheet.ts';

export interface Ctx {
  map: MlMap;
  layers: Layers;
  sheet: Sheet;
  open: (kind: Kind, props: Record<string, unknown>, lon: number, lat: number, push?: boolean) => void;
  routeTo: (lon: number, lat: number, label: string) => void;
}
export type Kind = 'congestion' | 'incident' | 'camera' | 'radar' | 'radarzone' | 'alert' | 'mobile' | 'stretch' | 'motos' | 'fuel' | 'ev' | 'evlive' | 'vms' | 'zbe' | 'quake' | 'toll' | 'fire';

const h = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.className = 'detail';
  d.innerHTML = html;
  return d;
};

const badge = (ic: IconName, color: string, size = 44) =>
  `<span class="badge" style="--c:${color};width:${size}px;height:${size}px">${iconSvg(ic, Math.round(size * 0.5), '#fff', 2.2)}</span>`;

const row = (ic: IconName, html: string) => `<div class="row">${iconSvg(ic, 18)}<div>${html}</div></div>`;

function distKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function near(ctx: Ctx, source: string, lon: number, lat: number, radiusKm: number, limit = 6) {
  return ctx.layers.features(source)
    .map((f) => ({ f, d: distKm([lon, lat], (f.geometry as GeoJSON.Point).coordinates as [number, number]) }))
    .filter((x) => x.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
}

function camStrip(ctx: Ctx, lon: number, lat: number, exclude?: string): HTMLElement | null {
  const cams = near(ctx, 'cameras', lon, lat, 8, 8).filter((x) => String(x.f.properties!.id) !== exclude);
  if (!cams.length) return null;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h3 class="sec">Cámaras cerca</h3>`;
  const strip = document.createElement('div');
  strip.className = 'cam-strip';
  for (const { f, d } of cams) {
    const p = f.properties as unknown as Camera;
    const [clon, clat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cam-thumb';
    b.innerHTML = `<img loading="lazy" alt="Cámara ${esc(p.road)} ${esc(km(p.km))}" src="/cam/${esc(p.id)}.jpg?t=${Math.floor(Date.now() / 120000)}"><span>${esc(p.road)} · ${d.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km</span>`;
    b.addEventListener('click', () => ctx.open('camera', p as unknown as Record<string, unknown>, clon, clat, true));
    strip.append(b);
  }
  wrap.append(strip);
  return wrap;
}

function actions(ctx: Ctx, lon: number, lat: number, label: string, share = true): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'actions';
  const go = document.createElement('button');
  go.className = 'btn';
  go.type = 'button';
  go.append(icon('navigation', 17), 'Cómo llegar');
  go.addEventListener('click', () => ctx.routeTo(lon, lat, label));
  bar.append(go);
  const maps = document.createElement('a');
  maps.className = 'btn ghost';
  maps.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  maps.target = '_blank';
  maps.rel = 'noopener';
  maps.append(icon('external', 16), 'Abrir en navegador GPS');
  bar.append(maps);
  void share; // sharing lives in the sheet header now
  return bar;
}

// ---------------------------------------------------------------- incidents

export function incident(ctx: Ctx, p: Incident, lon: number, lat: number): void {
  const c = CATS[p.cat as Cat] ?? CATS.otro;
  const what = (p.what ?? '').split(',').filter((w) => w && WHAT[w] && !['mandatory', 'anyVehicle', 'unknown'].includes(w));
  const place = [titleCase(p.muni), titleCase(p.prov)].filter(Boolean).join(', ');
  const kms = p.km != null ? (p.km2 != null ? `del km ${nf.format(Math.min(p.km, p.km2))} al ${nf.format(Math.max(p.km, p.km2))}` : km(p.km)) : '';
  const closure = p.closure === 'carretera' ? 'Carretera cortada' : p.closure === 'calzada' ? 'Calzada cortada en un sentido' : p.closure === 'carril' ? 'Carriles cortados' : '';
  const old = (p.days ?? 0) >= 7;
  const el = h(`<div class="hero">${badge(c.icon, c.color)}<div><p class="kicker" style="color:${c.color}">${esc(c.label)}${closure && p.cat !== 'cerrada' ? ` · ${esc(closure)}` : ''}</p>
    <p class="big">${esc(p.road || 'Vía sin nombre')} ${kms ? `<span class="muted">${esc(kms)}</span>` : ''}</p>
    ${place ? `<p class="muted">${esc(place)}</p>` : ''}</div></div>
    ${what.length ? `<div class="chips">${what.map((w) => `<span class="chip">${esc(WHAT[w])}</span>`).join('')}</div>` : ''}
    ${p.txt ? `<p class="note">${esc(titleCase(p.txt))}</p>` : ''}
    ${old ? `<p class="muted small">Aviso de larga duración: lleva ${p.days} días publicado.</p>` : ''}
    <div class="rows">
      ${p.start ? row('clock', `Desde ${esc(when(p.start))} <span class="muted">(${esc(ago(p.start))})</span>`) : ''}
      ${p.end ? row('calendar', `Previsto hasta ${esc(when(p.end))}`) : ''}
      ${p.dir && !['unknown', 'unspecified'].includes(p.dir) ? row('road', esc(WHAT[p.dir] ?? p.dir)) : ''}
      ${row('info', `Fuente: ${esc(SRC[p.src] ?? p.src)}`)}
    </div>`);
  const strip = camStrip(ctx, lon, lat);
  if (strip) el.append(strip);
  el.append(actions(ctx, lon, lat, `${c.label} en ${p.road}`));
  ctx.sheet.show(c.label, [p.road, place].filter(Boolean).join(' · '), el);
}

// ---------------------------------------------------------------- cameras

export function camera(ctx: Ctx, p: Camera, lon: number, lat: number, push = false): void {
  const el = h(`<figure class="cam-big"><img alt="Imagen en directo de la cámara de la ${esc(p.road)} ${esc(km(p.km))}" src="/cam/${esc(p.id)}.jpg?t=${Date.now()}">
    <figcaption><span class="live-dot"></span><span class="cam-age">En directo · se actualiza cada minuto</span></figcaption></figure>
    <div class="rows">${row('road', `${esc(p.road)} ${esc(km(p.km))}${p.dest ? ` <span class="muted">hacia ${esc(p.dest)}</span>` : ''}`)}
    ${p.prov ? row('pin', esc(titleCase(p.prov))) : ''}${row('info', 'Cámara de la DGT')}</div>`);
  const img = el.querySelector('img')!;
  img.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('p'), { className: 'muted cam-off', textContent: 'La cámara no está emitiendo ahora mismo.' })));
  const timer = window.setInterval(() => {
    if (!img.isConnected) return window.clearInterval(timer);
    img.src = `/cam/${p.id}.jpg?t=${Date.now()}`;
  }, 60000);
  // Previous / next camera on the same road.
  const same = ctx.layers.features('cameras').filter((f) => (f.properties as Camera).road === p.road && (f.properties as Camera).km != null)
    .sort((a, b) => ((a.properties as Camera).km ?? 0) - ((b.properties as Camera).km ?? 0));
  const i = same.findIndex((f) => (f.properties as Camera).id === p.id);
  if (i >= 0 && same.length > 1) {
    const nav = document.createElement('div');
    nav.className = 'cam-nav';
    for (const [dir, j] of [['prev', i - 1], ['next', i + 1]] as const) {
      const f = same[j];
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.type = 'button';
      b.disabled = !f;
      if (f) {
        const q = f.properties as Camera;
        b.append(...(dir === 'prev' ? [icon('chevronLeft', 18), `km ${nf.format(q.km ?? 0)}`] : [`km ${nf.format(q.km ?? 0)}`, icon('chevronRight', 18)]));
        b.addEventListener('click', () => {
          const [x, y] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          ctx.open('camera', q as unknown as Record<string, unknown>, x, y, false);
          ctx.map.easeTo({ center: [x, y], duration: 600 });
        });
      } else b.textContent = dir === 'prev' ? 'Primera' : 'Última';
      nav.append(b);
    }
    el.querySelector('.cam-big')!.after(nav);
  }
  const inc = near(ctx, 'incidents', lon, lat, 5, 4);
  if (inc.length) {
    const box = document.createElement('div');
    box.innerHTML = `<h3 class="sec">Avisos cerca</h3>`;
    box.append(incidentList(ctx, inc.map((x) => x.f)));
    el.append(box);
  }
  ctx.sheet.show(`Cámara ${p.road}`, [km(p.km), titleCase(p.prov)].filter(Boolean).join(' · '), el, { push });
}

// ---------------------------------------------------------------- radars and stretches

const RADAR_KIND: Record<string, { title: string; icon: IconName; color: string; text: string }> = {
  fijo: { title: 'Radar fijo', icon: 'cctv', color: '#e0201b', text: 'Mide la velocidad instantánea al pasar.' },
  tramo: { title: 'Radar de tramo', icon: 'section', color: '#0a84ff', text: 'Mide la velocidad media entre dos puntos: frenar solo ante la cámara no sirve.' },
  semaforo: { title: 'Cámara de semáforo en rojo', icon: 'lights', color: '#8e44ad', text: 'Fotografía a los vehículos que cruzan con el semáforo en rojo.' },
  cinturon: { title: 'Cámara de cinturón y móvil', icon: 'cctv', color: '#0f9d8a', text: 'Cámara de la DGT que detecta a quien circula sin cinturón o usando el móvil al volante.' },
  linea: { title: 'Cámara de línea continua', icon: 'minus', color: '#f08a24', text: 'Detecta los adelantamientos y cambios de carril pisando la línea continua.' },
  stop: { title: 'Cámara de stop', icon: 'closed', color: '#b3261e', text: 'Detecta a quien no se detiene en la señal de stop.' },
  remolque: { title: 'Radar remolque', icon: 'truck', color: '#ff9500', text: 'Punto donde el Servei Català de Trànsit coloca a veces uno de sus radares remolque. No siempre hay un radar: es una ubicación habitual, no una presencia confirmada.' },
};

const RADAR_SOURCE: Record<string, string> = {
  dgt: 'Fuente: listado oficial de la DGT de equipos y tramos de vigilancia.',
  sct: 'Fuente: Servei Català de Trànsit (Generalitat de Catalunya), listado oficial de radares.',
  madrid: 'Fuente: Ayuntamiento de Madrid, portal de datos abiertos.',
  osm: 'Fuente: comunidad de OpenStreetMap. Puede ser de un ayuntamiento, de una comunidad autónoma o no estar en las listas oficiales.',
};

/** "Válido del 3 de agosto al …" from ISO dates (date or date-time). */
function validity(from?: string, to?: string): string {
  const d = (x: string) => new Date(x.length === 10 ? `${x}T12:00:00` : x);
  const day = (x: string) => d(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const hm = (x: string) => d(x).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (from && to && from.slice(0, 10) === to.slice(0, 10) && from.length > 10) return `Hoy, ${day(from)}, de ${hm(from)} a ${hm(to)}`;
  if (from && to) return `Del ${day(from)} al ${day(to)}`;
  if (from) return `Desde el ${day(from)}`;
  return '';
}

export function radar(ctx: Ctx, p: Radar, lon: number, lat: number): void {
  const k = RADAR_KIND[p.kind] ?? RADAR_KIND.fijo!;
  const tramo = p.kind === 'tramo';
  const osm = p.src === 'osm';
  const compass = (d: string) => {
    const n = Number(d);
    if (Number.isNaN(n)) return d;
    return ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'][Math.round(((n % 360) + 360) % 360 / 45) % 8];
  };
  const dirText = !p.dir ? '' : p.dir === 'positive' ? 'Sentido creciente de la kilometración' : p.dir === 'negative' ? 'Sentido decreciente de la kilometración'
    : p.dir === 'bothWays' ? 'Ambos sentidos' : /^\d+$/.test(p.dir) ? `Controla a quien circula hacia el ${compass(p.dir)}` : p.dir;
  const kmText = tramo && p.km != null && p.km2 != null ? `km ${nf.format(Math.min(p.km, p.km2))} a ${nf.format(Math.max(p.km, p.km2))}` : km(p.km);
  const el = h(`<div class="hero">${badge(k.icon, k.color)}<div>
    <p class="kicker" style="color:${k.color}">${esc(k.title)}</p>
    <p class="big">${esc(p.road || (osm ? 'Vía urbana o sin identificar' : ''))} <span class="muted">${esc(kmText)}</span></p>
    ${p.prov ? `<p class="muted">${esc(titleCase(p.prov))}</p>` : ''}</div>
    ${p.maxspeed ? `<span class="speed-sign" aria-label="Límite ${p.maxspeed} km/h">${p.maxspeed}</span>` : ''}</div>
    <p class="note">${esc(k.text)}${p.note ? ` ${esc(p.note)}` : ''}</p>
    ${p.pos === 'aproximada' ? `<p class="warn">Posición aproximada: ${p.src === 'sct' ? 'las coordenadas publicadas no eran válidas y' : 'la DGT lo publica por punto kilométrico y'} lo hemos situado sobre la carretera por su punto kilométrico (margen habitual de unos cientos de metros).</p>` : ''}
    <div class="rows">${tramo && p.len ? row('gauge', `Tramo de <b>${nf.format(p.len)} km</b>`) : ''}
    ${dirText ? row('road', esc(dirText)) : ''}
    ${row('info', RADAR_SOURCE[p.src ?? 'dgt'] ?? RADAR_SOURCE.dgt!)}</div>`);
  el.append(actions(ctx, lon, lat, `${k.title} ${p.road ?? ''}`, false), sourcesLink(ctx));
  const srcLabel = ({ osm: 'OpenStreetMap', sct: 'Servei Català de Trànsit', madrid: 'Ayuntamiento de Madrid' } as Record<string, string>)[p.src ?? ''] ?? 'DGT';
  ctx.sheet.show(k.title, [p.road, km(p.km), srcLabel].filter(Boolean).join(' · '), el);
}

export function stretch(ctx: Ctx, p: Record<string, unknown>, kind: 'stretch' | 'motos'): void {
  const motos = kind === 'motos';
  const color = motos ? '#af52de' : '#ff2d55';
  const k1 = p.km as number | undefined;
  const k2 = p.km2 as number | undefined;
  const el = h(`<div class="hero">${badge(motos ? 'bike' : 'shield', color)}<div>
    <p class="kicker" style="color:${color}">${motos ? 'Tramo peligroso para motos' : 'Tramo de vigilancia intensificada (INVIVE)'}</p>
    <p class="big">${esc(p.road)} <span class="muted">${k1 != null && k2 != null ? `km ${nf.format(k1)} a ${nf.format(k2)}` : esc(km(k1))}</span></p>
    ${p.prov ? `<p class="muted">${esc(titleCase(String(p.prov)))}</p>` : ''}</div></div>
    ${p.ends ? '<p class="warn">No hemos podido trazar este tramo sobre la carretera: los círculos marcan su inicio y su fin.</p>' : ''}
    <p class="note">${motos ? 'Tramo señalizado con alta siniestralidad de motocicletas: la DGT recomienda extremar la precaución y aumenta la vigilancia.' : 'Zona de vigilancia: la DGT intensifica aquí los controles de velocidad, normalmente con radares móviles o vehículos camuflados. No indica dónde hay un radar ni si lo hay ahora.'}</p>`);
  ctx.sheet.show(motos ? 'Tramo de riesgo para motos' : 'Zona de vigilancia', String(p.road ?? ''), el);
}

/** A stretch where the DGT places mobile radars (its report, "Radar Móvil" from km X to km Y). */
export function radarZone(ctx: Ctx, p: Record<string, unknown>): void {
  const color = '#ff6b35';
  const k1 = p.km as number | undefined;
  const k2 = p.km2 as number | undefined;
  const el = h(`<div class="hero">${badge('radar', color)}<div>
    <p class="kicker" style="color:${color}">Zona de vigilancia con radar móvil</p>
    <p class="big">${esc(p.road)} <span class="muted">${k1 != null && k2 != null ? `km ${nf.format(Math.min(k1, k2))} a ${nf.format(Math.max(k1, k2))}` : ''}</span></p>
    ${p.prov ? `<p class="muted">${esc(titleCase(String(p.prov)))}</p>` : ''}</div></div>
    ${p.ends ? '<p class="warn">No hemos podido trazar este tramo sobre la carretera: los círculos marcan su inicio y su fin.</p>' : ''}
    <p class="note">La DGT incluye este tramo en su lista de lugares donde controla la velocidad con radares móviles. Es una zona de vigilancia, no la ubicación exacta de un radar: puede haberlo en cualquier punto del tramo, o no haber ninguno hoy.</p>
    <div class="rows">${p.len ? row('gauge', `Tramo de <b>${nf.format(Number(p.len))} km</b>`) : ''}
    ${p.valid_from ? row('calendar', `En la lista de la DGT del ${esc(validity(String(p.valid_from)).replace(/^Desde el /, ''))}`) : ''}
    ${row('info', 'Fuente: informe oficial de cinemómetros de la DGT.')}</div>`);
  el.append(sourcesLink(ctx));
  ctx.sheet.show('Zona de radar móvil', String(p.road ?? ''), el);
}

const ALERT_KIND: Record<string, [string, string]> = {
  movil: ['Control móvil de velocidad anunciado', 'El panel avisa de un control con radar móvil más adelante.'],
  tramo: ['Radar de tramo anunciado', 'El panel recuerda que la velocidad se controla en tramo.'],
  radar: ['Control de velocidad anunciado', 'El panel avisa de que la velocidad está controlada por radar.'],
};

/** A DGT message sign announcing a speed check: valid while the sign shows it. */
export function alert(ctx: Ctx, p: Alert, lon: number, lat: number): void {
  const [title, text] = ALERT_KIND[p.kind] ?? ALERT_KIND.radar!;
  const color = p.kind === 'movil' ? '#ff9500' : '#e0201b';
  const lines = (p.lines || '').split('\n').filter(Boolean);
  const picts = (p.picts || '').split(',').filter(Boolean);
  const el = h(`<div class="hero">${badge('megaphone', color)}<div>
    <p class="kicker" style="color:${color}">${esc(title)}</p>
    <p class="big">${esc(p.road)} <span class="muted">${esc(km(p.km))}</span></p>
    ${p.dest ? `<p class="muted">Hacia ${esc(p.dest)}</p>` : ''}</div>
    ${p.limit ? `<span class="speed-sign" aria-label="Límite ${p.limit} km/h">${p.limit}</span>` : ''}</div>
    <div class="vms-board" role="img" aria-label="Panel: ${esc(lines.join('. '))}">
    ${picts.length ? `<div class="vms-picts">${picts.slice(0, 2).map((c) => `<img alt="" src="/pict/${esc(c)}.png">`).join('')}</div>` : ''}
    <div class="vms-text">${lines.map((l) => `<span>${esc(l)}</span>`).join('') || '<span class="muted">(solo pictograma)</span>'}</div></div>
    <p class="note">${esc(text)} Lo mostramos mientras el panel siga anunciándolo; el punto es el del panel, no el del radar${p.ahead ? `, que según el panel está a unos ${nf.format(p.ahead)} km` : ''}.</p>
    <div class="rows">${p.valid_from ? row('clock', `Anunciado ${esc(when(p.valid_from))} <span class="muted">(${esc(ago(p.valid_from))})</span>`) : ''}
    ${row('info', 'Panel de mensaje variable de la DGT. Cataluña y el País Vasco no publican sus paneles en este fichero.')}</div>`);
  el.querySelectorAll('.vms-picts img').forEach((img) => img.addEventListener('error', () => img.remove()));
  el.append(actions(ctx, lon, lat, title, false), sourcesLink(ctx));
  ctx.sheet.show('Control anunciado', `${p.road} ${km(p.km)}`, el);
}

const MOBILE_SRC: Record<string, string> = {
  donostia: 'Ayuntamiento de Donostia / San Sebastián: ubicación del radar móvil de hoy.',
  leon: 'Ayuntamiento de León: calendario mensual de radares móviles.',
  bcn_multas: 'Multas de velocidad del Ajuntament de Barcelona (datos abiertos).',
  madrid_multas: 'Multas de velocidad del Ayuntamiento de Madrid (datos abiertos).',
};

/** A council's mobile radar for today, or a historical zone learnt from fines. */
export function mobileZone(ctx: Ctx, p: MobileZone, lon: number, lat: number): void {
  const today = p.kind === 'anunciado';
  const color = today ? '#ff9500' : '#8e5cd9';
  const hours = (p.hours || '').split(',').filter(Boolean).map(Number);
  const hourText = hours.length ? hours.map((x) => `${String(x).padStart(2, '0')}:00`).join(', ') : '';
  const el = h(`<div class="hero">${badge(today ? 'megaphone' : 'history', color)}<div>
    <p class="kicker" style="color:${color}">${today ? 'Radar móvil anunciado para hoy' : 'Zona de riesgo histórica'}</p>
    <p class="big">${esc(p.title)}</p>
    <p class="muted">${esc(p.city)}${p.title_eu && p.title_eu !== p.title ? ` · ${esc(p.title_eu)}` : ''}</p></div>
    ${p.limit ? `<span class="speed-sign" aria-label="Límite ${p.limit} km/h">${p.limit}</span>` : ''}</div>
    <p class="note">${today
      ? 'El ayuntamiento anuncia un control con radar móvil en esta calle. Marcamos toda la calle porque no publica el punto exacto.'
      : `Calle donde hubo multas de velocidad en sesiones cortas, unos pocos días: el patrón de un radar móvil, no el de uno fijo. Son datos con meses de retraso: indican dónde se ha controlado antes, no dónde hay un radar ahora.`}</p>
    <div class="rows">${p.valid_from ? row('calendar', esc(today ? validity(p.valid_from, p.valid_to) : `Multas ${validity(p.valid_from, p.valid_to).replace(/^D/, 'd')}`)) : ''}
    ${p.fines ? row('gauge', `<b>${nf.format(p.fines)}</b> multas de velocidad${p.days ? ` en ${nf.format(p.days)} días` : ''}${p.span_h != null ? ` · sesiones de unas ${nf.format(Math.max(0.5, p.span_h))} h` : ''}`) : ''}
    ${hourText ? row('clock', `Horas con multas: ${esc(hourText)}`) : ''}
    ${p.place && p.place !== p.title ? row('road', `Lugar publicado: ${esc(p.place)}`) : ''}
    ${row('info', `Fuente: ${esc(MOBILE_SRC[p.src] ?? p.src)}${p.geo ? ` Calle situada con ${esc(p.geo)}.` : ''}`)}</div>`);
  el.append(actions(ctx, lon, lat, p.title, false), sourcesLink(ctx));
  ctx.sheet.show(today ? 'Radar móvil de hoy' : 'Zona de riesgo histórica', p.city, el);
}

function sourcesLink(ctx: Ctx): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-button';
  b.innerHTML = `${iconSvg('info', 16)} Estado de las fuentes de radares`;
  b.addEventListener('click', () => void sources(ctx));
  return b;
}

const SOURCE_STATUS: Record<string, [string, string]> = { ok: ['Al día', 'ok'], obsoleta: ['Obsoleta', 'stale'], falta: ['Falta', 'missing'] };

/** Each enforcement source: ok / stale / missing, age of its data and licence. */
export async function sources(ctx: Ctx): Promise<void> {
  const el = h(`<p class="muted loading">${iconSvg('loader', 16)} Cargando…</p>`);
  ctx.sheet.show('Fuentes de radares', 'Estado y antigüedad de cada fuente', el, { push: true });
  const stamp = ctx.sheet.stamp;
  const data = await live<{ generated: string; sources: SourceStatus[] }>('sources', 60).catch(() => null);
  if (ctx.sheet.stamp !== stamp) return;
  if (!data) {
    el.innerHTML = '<p class="warn">No se ha podido cargar el estado de las fuentes.</p>';
    return;
  }
  const age = (d?: number | null) => d == null ? '' : d < 1 ? 'datos de hoy' : d < 60 ? `datos de hace ${Math.round(d)} días` : `datos de hace ${Math.round(d / 30.4)} meses`;
  el.innerHTML = `<p class="note">Si una fuente falla seguimos mostrando su última copia buena, marcada como obsoleta cuando envejece.</p>
    <ul class="list sources-list">${data.sources.map((s) => {
      const [label, cls] = SOURCE_STATUS[s.status] ?? SOURCE_STATUS.falta!;
      return `<li><div><span class="status-chip ${cls}">${label}</span> <b>${esc(s.name)}</b><br>
        <small>${esc(s.by)} · ${esc(s.licence)}${s.count != null && s.status !== 'falta' ? ` · ${nf.format(s.count)} elementos` : ''}${s.data_age_days != null ? ` · ${age(s.data_age_days)}` : ''}${s.fetched ? ` · revisada ${esc(ago(s.fetched))}` : ''}</small>
        ${s.why ? `<br><small class="muted">${esc(s.why)}</small>` : ''}${s.note ? `<br><small class="muted">${esc(s.note)}</small>` : ''}
        ${s.url ? `<br><a class="small" href="${esc(s.url)}" target="_blank" rel="noopener">Origen ${iconSvg('external', 12)}</a>` : ''}</div></li>`;
    }).join('')}</ul>`;
}

// ---------------------------------------------------------------- variable message signs

export function vms(ctx: Ctx, p: Panel): void {
  const lines = (p.lines || '').split('\n').filter(Boolean);
  const picts = (p.picts || '').split(',').filter(Boolean);
  const el = h(`<div class="vms-board" role="img" aria-label="Panel: ${esc(lines.join('. '))}">
    ${picts.length ? `<div class="vms-picts">${picts.slice(0, 2).map((c) => `<img alt="" src="/pict/${esc(c)}.png">`).join('')}</div>` : ''}
    <div class="vms-text">${lines.map((l) => `<span>${esc(l)}</span>`).join('') || '<span class="muted">(solo pictograma)</span>'}</div></div>
    <div class="rows">${row('road', `${esc(p.road)} ${esc(km(p.km))}${p.dest ? ` <span class="muted">hacia ${esc(p.dest)}</span>` : ''}`)}
    ${p.set ? row('clock', `Mensaje puesto ${esc(when(p.set))} <span class="muted">(${esc(ago(p.set))})</span>`) : ''}
    ${row('info', 'Panel de mensaje variable de la DGT')}</div>`);
  el.querySelectorAll('.vms-picts img').forEach((img) => img.addEventListener('error', () => img.remove()));
  ctx.sheet.show('Panel informativo', `${p.road} ${km(p.km)}`, el);
}

// ---------------------------------------------------------------- fuel

function priceClass(v: number, pct: number[] | undefined): [string, string] {
  if (!pct) return ['', ''];
  if (v <= pct[1]!) return ['cheap', 'Barata'];
  if (v >= pct[3]!) return ['dear', 'Cara'];
  return ['mid', 'En la media'];
}

export function fuel(ctx: Ctx, p: Station, lon: number, lat: number): void {
  const fc = ctx.layers.get('fuel') as FC | undefined;
  const pct = fc?.pct ?? {};
  const prices = Object.entries(p).filter(([k, v]) => k.startsWith('p_') && typeof v === 'number').map(([k, v]) => [k.slice(2), v as number] as const);
  const order = FUELS.map((f) => f.code);
  prices.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
  const sel = ctx.layers.fuel;
  // Rank among stations within 5 km for the selected fuel.
  let rank = '';
  let rankGood = false;
  const mine = p[`p_${sel}`];
  if (typeof mine === 'number') {
    const around = near(ctx, 'fuel', lon, lat, 5, 500).map((x) => (x.f.properties as Station)[`p_${sel}`]).filter((v): v is number => typeof v === 'number');
    if (around.length > 2) {
      const pos = around.filter((v) => v < mine).length + 1;
      rankGood = pos <= Math.ceil(around.length / 3);
      rank = pos === 1 ? `La más barata de ${around.length} en 5 km para ${FUEL_LABEL[sel]?.toLowerCase()}` : `Puesto ${pos} de ${around.length} en 5 km para ${FUEL_LABEL[sel]?.toLowerCase()}`;
    }
  }
  const el = h(`<div class="hero">${badge('fuel', '#34c759')}<div><p class="big">${esc(p.brand || 'Gasolinera')}</p>
    <p class="muted">${esc(p.addr)}, ${esc(p.muni)}</p>${!p.public ? '<p class="warn">Venta restringida a socios o clientes</p>' : ''}</div></div>
    ${rank ? `<p class="pill-note ${rankGood ? '' : 'meh'}">${iconSvg(rankGood ? 'down' : 'up', 16)} ${esc(rank)}</p>` : ''}
    <table class="prices">${prices.map(([code, v]) => {
      const [cls, label] = priceClass(v, pct[code]);
      return `<tr><th>${esc(FUEL_LABEL[code] ?? code)}</th><td><b>${price(v)}</b></td><td>${cls ? `<span class="tag ${cls}">${label}</span>` : ''}</td></tr>`;
    }).join('')}</table>
    <div class="rows">${p.hours ? row('clock', `${openLine(p)}${esc(p.hours.replace(/;/g, ' · '))}${openState(p.hours, p.prov).open === null ? '' : '</span>'}`) : ''}
    ${row('info', `Precios del Ministerio para la Transición Ecológica · ${esc(fc?.source_time ? `datos de ${fc.source_time.split(' ')[1]?.slice(0, 5) ?? ''}` : '')}`)}</div>
    <h3 class="sec">Historia del precio</h3><div class="hist"><p class="muted">Cargando…</p></div>`);
  el.append(actions(ctx, lon, lat, p.brand || 'Gasolinera'));
  ctx.sheet.show(p.brand || 'Gasolinera', `${p.muni} · ${p.prov}`, el);
  void history(el.querySelector('.hist')!, p.id, sel);
}

function openLine(p: Station): string {
  const o = openState(p.hours, p.prov);
  if (o.open === null) return '';
  return `<b class="${o.open ? 'open-now' : 'closed-now'}">${esc(o.text)}</b><br><span class="muted">`;
}

async function history(box: HTMLElement, id: string, sel: string): Promise<void> {
  try {
    const r = await fetch(`/api/fuel/station/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { series: Record<string, [string, number][]>; info?: { first_day?: string } };
    const codes = Object.keys(j.series).filter((c) => (j.series[c]?.length ?? 0) > 0);
    if (!codes.length) {
      box.innerHTML = '<p class="muted">Aún no tenemos historia de esta gasolinera.</p>';
      return;
    }
    const show = (code: string) => {
      const pts = (j.series[code] ?? []).map(([d, v]) => [Date.parse(d), v] as [number, number]);
      const now = Date.now();
      if (pts.length) pts.push([now, pts[pts.length - 1]![1]]);
      const yearAgo = now - 365 * 864e5;
      const last = pts.filter((q) => q[0] >= yearAgo);
      const min = last.length ? last.reduce((a, b) => (b[1] < a[1] ? b : a)) : undefined;
      const max = last.length ? last.reduce((a, b) => (b[1] > a[1] ? b : a)) : undefined;
      const chart = lineChart([{ label: FUEL_LABEL[code] ?? code, color: '#34c759', points: pts, step: true }], {
        height: 190, yFormat: (v) => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        xFormat: (t) => (pts[0] && now - pts[0][0] < 400 * 864e5 ? new Date(t).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : String(new Date(t).getFullYear())),
      });
      const facts = document.createElement('p');
      facts.className = 'muted small';
      facts.textContent = min && max ? `Último año: mínimo ${price(min[1])} (${new Date(min[0]).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}), máximo ${price(max[1])}. Datos desde ${new Date(pts[0]![0]).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}.` : '';
      box.replaceChildren(tabs, chart, facts);
    };
    const tabs = document.createElement('div');
    tabs.className = 'seg';
    const first = codes.includes(sel) ? sel : codes[0]!;
    for (const c of codes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = FUELS.find((f) => f.code === c)?.short ?? FUEL_LABEL[c] ?? c;
      b.setAttribute('aria-pressed', String(c === first));
      b.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        show(c);
      });
      tabs.append(b);
    }
    show(first);
  } catch {
    box.innerHTML = '<p class="muted">No se pudo cargar la historia ahora.</p>';
  }
}

// ---------------------------------------------------------------- charging

const STATUS: Record<string, [string, string]> = {
  AVAILABLE: ['Libre', 'ok'], CHARGING: ['Cargando', 'busy'], BLOCKED: ['Ocupado', 'busy'], RESERVED: ['Reservado', 'busy'],
  OUTOFORDER: ['Averiado', 'bad'], INOPERATIVE: ['Fuera de servicio', 'bad'], PLANNED: ['Previsto', 'off'], REMOVED: ['Retirado', 'off'], UNKNOWN: ['Sin datos', 'off'],
};
const STD: Record<string, string> = { IEC_62196_T2_COMBO: 'CCS', IEC_62196_T2: 'Tipo 2', CHADEMO: 'CHAdeMO', DOMESTIC_F: 'Schuko', IEC_62196_T1: 'Tipo 1', TESLA_S: 'Tesla', TESLA_R: 'Tesla' };

interface ReveLoc { id: string; name: string; addr: string; owner?: string; web?: string; h24: boolean; evses: { id: string; ref?: string; status: string; since?: string; conns: { std: string; kw: number; price: string[] }[]; pay: string[] }[] }

export function charger(ctx: Ctx, p: Charger, lon: number, lat: number): void {
  const conns = (p.conns || '').split(',').filter(Boolean).map((c) => c.split(':'));
  const el = h(`<div class="hero">${badge(p.dc ? 'zap' : 'plug', '#00a6a6')}<div><p class="big">${esc(p.name || p.op || 'Punto de recarga')}</p>
    <p class="muted">${esc([p.addr, p.muni].filter(Boolean).join(', '))}</p></div></div>
    <div class="stats"><div><b>${p.kw ? nf.format(p.kw) : '—'}</b><span>kW máx.</span></div><div><b>${p.points || '—'}</b><span>puntos</span></div>
    <div><b>${conns.map(([k]) => esc(k)).join(' · ') || '—'}</b><span>conectores</span></div></div>
    <div class="rows">${p.op ? row('plug', `Operador: ${esc(p.op)}`) : ''}${p.hours ? row('clock', esc(p.hours.length > 120 ? `${p.hours.slice(0, 117)}…` : p.hours)) : ''}</div>
    <h3 class="sec">Ahora mismo</h3><div class="evlive"><p class="muted">Consultando el estado en REVE…</p></div>`);
  el.append(actions(ctx, lon, lat, p.name || 'Punto de recarga'));
  ctx.sheet.show(p.name || 'Punto de recarga', [p.muni, p.prov].filter(Boolean).join(' · '), el);
  void liveCharger(el.querySelector('.evlive')!, lon, lat);
}

export async function liveCharger(box: HTMLElement, lon: number, lat: number, id?: string): Promise<void> {
  try {
    let locId = id;
    if (!locId) {
      const d = 0.004;
      const r = await fetch(`/api/ev/markers?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&z=16`);
      if (!r.ok) throw new Error();
      const ms = (await r.json()) as { t: string; lon: number; lat: number; id?: string }[];
      const best = ms.filter((m) => m.t === 'l' && m.id).map((m) => ({ m, d: distKm([lon, lat], [m.lon, m.lat]) })).sort((a, b) => a.d - b.d)[0];
      if (!best || best.d > 0.12) {
        box.innerHTML = '<p class="muted">Este punto no envía su estado en tiempo real a REVE (solo es obligatorio desde 43 kW).</p>';
        return;
      }
      locId = best.m.id;
    }
    const r = await fetch(`/api/ev/location/${locId}`);
    if (!r.ok) throw new Error();
    const loc = (await r.json()) as ReveLoc;
    const counts = { ok: 0, busy: 0, bad: 0 };
    for (const e of loc.evses) {
      const s = STATUS[e.status]?.[1];
      if (s === 'ok' || s === 'busy' || s === 'bad') counts[s]++;
    }
    box.innerHTML = `<p class="ev-sum"><span class="dot ok"></span>${counts.ok} libres <span class="dot busy"></span>${counts.busy} en uso <span class="dot bad"></span>${counts.bad} averiados</p>
      <ul class="evses">${loc.evses.map((e) => {
        const [label, cls] = STATUS[e.status] ?? [e.status, 'off'];
        const c = e.conns[0];
        const pr = e.conns.flatMap((x) => x.price).filter(Boolean)[0];
        return `<li><span class="tag ${cls}">${esc(label)}</span><span class="evse-name">${esc(e.ref || e.id?.split('*').pop() || '')}</span>
          <span>${esc(e.conns.map((x) => STD[x.std] ?? x.std).join(' + '))}${c?.kw ? ` · ${nf.format(c.kw)} kW` : ''}</span>
          <span class="evse-price">${pr ? esc(pr.replace('EUR', '€').replace('.', ',')) : '<span class="muted">precio no publicado</span>'}</span>
          ${e.since ? `<small class="muted">${esc(ago(e.since))}</small>` : ''}</li>`;
      }).join('')}</ul>
      <p class="muted small">${loc.owner ? `${esc(loc.owner)} · ` : ''}Estado y precio en tiempo real de REVE (Red Eléctrica). Precios con IVA según publica el operador.</p>`;
  } catch {
    box.innerHTML = '<p class="muted">No se pudo consultar el estado en tiempo real ahora.</p>';
  }
}

export function chargerLive(ctx: Ctx, p: { id: string; name?: string }, lon: number, lat: number): void {
  const el = h(`<div class="hero">${badge('zap', '#00a6a6')}<div><p class="big">${esc(p.name || 'Punto de recarga')}</p></div></div><div class="evlive"><p class="muted">Consultando…</p></div>`);
  el.append(actions(ctx, lon, lat, p.name || 'Punto de recarga'));
  ctx.sheet.show(p.name || 'Punto de recarga', 'Estado en tiempo real', el);
  void liveCharger(el.querySelector('.evlive')!, lon, lat, p.id);
}

// ---------------------------------------------------------------- ZBE

const BADGE_STYLE: Record<string, [string, string]> = {
  '0': ['#1d6fd1', 'CERO'], ECO: ['#1f9e6e', 'ECO'], C: ['#2fa84f', 'C'], B: ['#e7b416', 'B'], A: ['#8e8e93', 'Sin etiqueta'],
};
export function zbe(ctx: Ctx, p: Zone): void {
  const banned = p.banned === '?' ? null : (p.banned || '').split(',').filter(Boolean);
  const all = ['0', 'ECO', 'C', 'B', 'A'];
  const pill = (b: string, ok: boolean) => `<span class="dgt-badge ${ok ? '' : 'no'}" style="--c:${BADGE_STYLE[b]![0]}">${BADGE_STYLE[b]![1]}</span>`;
  const el = h(`<div class="hero">${badge('leaf', '#30a46c')}<div><p class="big">${esc(p.name)}</p><p class="muted">${esc(p.city)}${p.since ? ` · desde ${esc(new Date(p.since).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}` : ''}</p></div></div>
    ${banned ? `<h3 class="sec">Quién puede entrar</h3><div class="badges">${all.map((b) => pill(b, !banned.includes(b))).join('')}</div>
      <p class="muted small">Tachadas: etiquetas con restricción de acceso según el fichero de la DGT. Residentes, servicios y otros casos suelen tener excepciones.</p>`
      : '<p class="note">El fichero de la DGT no deja claro qué etiquetas se restringen aquí. Consulta las condiciones del ayuntamiento.</p>'}
    ${p.periods ? row('clock', esc(p.periods)) : ''}
    ${p.url ? `<p><a class="btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener">${iconSvg('external', 16)} Normas del ayuntamiento</a></p>` : ''}`);
  ctx.sheet.show(p.name, `Zona de bajas emisiones · ${p.city}`, el);
}

// ---------------------------------------------------------------- earthquakes

export function quake(ctx: Ctx, p: Quake): void {
  const el = h(`<div class="hero">${badge('activity', '#a2845e')}<div><p class="kicker">Terremoto</p><p class="big">Magnitud ${p.mag != null ? nf.format(p.mag) : '—'}</p><p class="muted">${esc(titleCase(p.place))}</p></div></div>
    <div class="rows">${row('clock', esc(p.when))}${row('info', 'Instituto Geográfico Nacional')}</div>
    ${p.url ? `<p><a class="btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener">${iconSvg('external', 16)} Ficha del IGN</a></p>` : ''}`);
  ctx.sheet.show('Terremoto', titleCase(p.place), el);
}

// ---------------------------------------------------------------- lists

export function incidentList(ctx: Ctx, feats: GeoJSON.Feature[]): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'list';
  for (const f of feats) {
    const p = f.properties as unknown as Incident;
    const c = CATS[p.cat] ?? CATS.otro;
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${badge(c.icon, c.color, 32)}<span><b>${esc(p.road || c.label)}</b> ${p.km != null ? `<span class="muted">${esc(km(p.km))}</span>` : ''}<br><small>${esc(c.label)} · ${esc(titleCase(p.muni) || titleCase(p.prov))}</small></span><small class="muted">${esc(ago(p.start))}</small>`;
    b.addEventListener('click', () => {
      ctx.map.flyTo({ center: [lon, lat], zoom: Math.max(ctx.map.getZoom(), 12), duration: 900 });
      ctx.open('incident', p as unknown as Record<string, unknown>, lon, lat, true);
    });
    li.append(b);
    ul.append(li);
  }
  return ul;
}

// ---------------------------------------------------------------- city congestion

export function congestion(ctx: Ctx, p: Congestion): void {
  const [label, color] = TRAFFIC_STATE[p.state] ?? ['Sin datos', '#8e8e93'];
  const el = h(`<div class="hero">${badge('gauge', color)}<div><p class="kicker" style="color:${color}">${esc(label)}</p>
    <p class="big">${esc(p.name || 'Tramo urbano')}</p><p class="muted">${esc(p.city)}</p></div></div>
    <div class="rows">${p.load != null && p.city === 'Madrid' ? row('gauge', `Carga de la vía: <b>${p.load} %</b>`) : ''}
    ${p.flow ? row('car', `Intensidad: <b>${nf.format(p.flow)}</b> vehículos/hora`) : ''}
    ${row('info', p.city === 'Madrid' ? 'Sensores del Ayuntamiento de Madrid (Informo), cada 5 minutos.' : 'Estado del tráfico del Ayuntamiento de Barcelona, cada 5 minutos.')}</div>`);
  ctx.sheet.show(`Tráfico: ${label.toLowerCase()}`, p.city, el);
}

// ---------------------------------------------------------------- tolls and service areas

export function toll(ctx: Ctx, p: Record<string, unknown>, lon: number, lat: number): void {
  const kind = String(p.kind ?? '');
  const name = String(p.name ?? '');
  if (kind === 'services' || kind === 'rest_area') {
    const svc = kind === 'services';
    const el = h(`<div class="hero">${badge(svc ? 'coffee' : 'tree', svc ? '#5e5ce6' : '#7c8a6e')}<div>
      <p class="kicker" style="color:${svc ? '#5e5ce6' : '#7c8a6e'}">${svc ? 'Área de servicio' : 'Área de descanso'}</p>
      <p class="big">${esc(name || (svc ? 'Área de servicio' : 'Área de descanso'))}</p>${p.brand ? `<p class="muted">${esc(p.brand)}</p>` : ''}</div></div>
      <p class="note">${svc ? 'Suele tener gasolinera, cafetería o restaurante y aseos.' : 'Zona para parar y descansar, normalmente sin más servicios.'}</p>
      <div class="rows">${row('info', 'Fuente: comunidad de OpenStreetMap')}</div>`);
    const fuel = near(ctx, 'fuel', lon, lat, 0.6, 1)[0];
    if (fuel) {
      const st = fuel.f.properties as Station;
      const v = st[`p_${ctx.layers.fuel}`];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost';
      b.append(icon('fuel', 16), `${st.brand || 'Gasolinera'}${typeof v === 'number' ? ` · ${price(v)}` : ''}`);
      const [x, y] = (fuel.f.geometry as GeoJSON.Point).coordinates as [number, number];
      b.addEventListener('click', () => ctx.open('fuel', st as unknown as Record<string, unknown>, x, y, true));
      el.append(b);
    }
    el.append(actions(ctx, lon, lat, name || 'Área de servicio'));
    ctx.sheet.show(svc ? 'Área de servicio' : 'Área de descanso', name, el);
    return;
  }
  const road = String(p.ref ?? '').split(';')[0] ?? '';
  if (kind === 'booth') {
    const el = h(`<div class="hero">${badge('ticket', '#ff9f0a')}<div><p class="kicker" style="color:#c87800">Peaje</p>
      <p class="big">${esc(name || 'Estación de peaje')}</p>${p.op ? `<p class="muted">${esc(p.op)}</p>` : ''}</div></div>
      <div class="rows">${row('info', 'Ubicación de la estación de peaje según OpenStreetMap. El precio depende del tramo recorrido y del tipo de vehículo: consúltalo en la web de la concesionaria.')}</div>`);
    el.append(actions(ctx, lon, lat, name || 'Peaje'));
    ctx.sheet.show('Peaje', name, el);
    return;
  }
  const el = h(`<div class="hero">${badge('ticket', '#ff9f0a')}<div><p class="kicker" style="color:#c87800">Autopista de peaje</p>
    <p class="big">${esc(road || name || 'Vía de peaje')}</p>${name && road ? `<p class="muted">${esc(name)}</p>` : ''}${p.op ? `<p class="muted">${esc(p.op)}</p>` : ''}</div></div>
    <p class="note">Tramo de pago. Si quieres evitarlo, el planificador de viajes tiene la opción «Sin peajes».</p>
    <div class="rows">${row('info', 'Fuente: comunidad de OpenStreetMap')}</div>`);
  ctx.sheet.show('Autopista de peaje', road, el);
}

// ---------------------------------------------------------------- wildfires

export function fire(ctx: Ctx, p: Record<string, unknown>, lon: number, lat: number): void {
  if (p.kind === 'burnt') {
    const area = Number(p.area ?? 0);
    const el = h(`<div class="hero">${badge('flame', '#7a3b1d')}<div><p class="kicker" style="color:#a0522d">Zona quemada</p>
      <p class="big">${area ? `${nf.format(area)} ha` : 'Incendio reciente'}</p>${p.place ? `<p class="muted">${esc(p.place)}</p>` : ''}</div></div>
      <div class="rows">${p.date ? row('calendar', `Detectado el ${esc(new Date(String(p.date)).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))}`) : ''}
      ${row('info', 'Superficie quemada cartografiada por satélite por el Sistema Europeo de Información sobre Incendios Forestales (EFFIS, Copernicus). Últimos 30 días.')}</div>`);
    ctx.sheet.show('Zona quemada', String(p.place ?? ''), el);
    return;
  }
  const n = Number(p.n ?? 1);
  const frp = Number(p.frp ?? 0);
  const strength = frp >= 100 ? 'muy intenso' : frp >= 25 ? 'intenso' : frp >= 5 ? 'moderado' : 'débil';
  const roads = near(ctx, 'incidents', lon, lat, 10, 4);
  const el = h(`<div class="hero">${badge('flame', '#ff453a')}<div><p class="kicker" style="color:#ff453a">Foco de calor detectado por satélite</p>
    <p class="big">${n > 1 ? `${nf.format(n)} detecciones` : '1 detección'} <span class="muted">· ${strength}</span></p>
    <p class="muted">Última: ${esc(ago(String(p.last)))}</p></div></div>
    <p class="warn">${iconSvg('alert', 16)} Puede ser un incendio forestal, una quema agrícola o una fuente de calor industrial. Si ves humo, llama al 112.</p>
    <div class="rows">${row('clock', `Primera detección ${esc(when(String(p.first)))}`)}
    ${row('gauge', `Potencia radiativa: ${nf.format(frp)} MW`)}
    ${row('info', 'Satélites VIIRS (NASA FIRMS). Cada píxel cubre unos 375 m; los datos llegan unas 3 horas después de cada paso.')}</div>`);
  if (roads.length) {
    const box = document.createElement('div');
    box.innerHTML = '<h3 class="sec">Avisos de tráfico a menos de 10 km</h3>';
    box.append(incidentList(ctx, roads.map((x) => x.f)));
    el.append(box);
  }
  const strip = camStrip(ctx, lon, lat);
  if (strip) el.append(strip);
  ctx.sheet.show('Foco de calor', `${lat.toFixed(3)}, ${lon.toFixed(3)}`, el);
}
