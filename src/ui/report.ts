// "Avisar": send a community warning (mobile speed camera, police check, accident...) at your
// position or at the centre of the map, marked by a crosshair while the panel is open.
import type { Map as MlMap } from 'maplibre-gl';
import { esc } from '../data.ts';
import { REPORT_LOOK } from './details.ts';
import { icon, iconSvg } from './icons.ts';
import type { Sheet } from './sheet.ts';

const OPTIONS: [string, string][] = [
  ['radar_movil', 'Radar móvil'], ['control', 'Control policial'], ['accidente', 'Accidente'],
  ['atasco', 'Retención'], ['obstaculo', 'Obstáculo'], ['vehiculo_parado', 'Vehículo parado'],
];

export function openReporter(map: MlMap, sheet: Sheet, app: HTMLElement, done: () => void): void {
  const cross = document.createElement('div');
  cross.className = 'crosshair';
  cross.setAttribute('aria-hidden', 'true');
  cross.append(icon('crosshair', 34));
  let where: 'center' | 'gps' = 'center';
  let gps: [number, number] | null = null;
  const el = document.createElement('div');
  el.className = 'detail reporter';
  el.innerHTML = `<p class="muted">¿Qué has visto? El aviso es anónimo y desaparece solo en una o dos horas.</p>
    <div class="rep-grid">${OPTIONS.map(([k, label]) => `<button type="button" class="rep-opt" data-kind="${k}" style="--c:${REPORT_LOOK[k]![1]}">${iconSvg(REPORT_LOOK[k]![0], 22)}<span>${esc(label)}</span></button>`).join('')}</div>
    <div class="seg rep-where" role="group" aria-label="Lugar del aviso"><button type="button" data-w="center" aria-pressed="true">${iconSvg('crosshair', 15)} Centro del mapa</button><button type="button" data-w="gps" aria-pressed="false">${iconSvg('locate', 15)} Mi ubicación</button></div>
    <p class="rep-status muted small">Mueve el mapa para poner el punto de mira donde está.</p>
    <p class="muted small">Si conduces, que lo haga quien te acompaña. Avisar de radares es legal; usar detectores, no.</p>`;
  const status = el.querySelector<HTMLElement>('.rep-status')!;
  el.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => {
    where = b.dataset.w as 'center' | 'gps';
    el.querySelectorAll('[data-w]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    cross.hidden = where !== 'center';
    if (where === 'gps') {
      status.textContent = 'Buscando tu ubicación…';
      navigator.geolocation?.getCurrentPosition((p) => {
        gps = [p.coords.longitude, p.coords.latitude];
        status.textContent = `Ubicación encontrada (±${Math.round(p.coords.accuracy)} m).`;
        map.easeTo({ center: gps, zoom: Math.max(map.getZoom(), 14) });
      }, () => { status.textContent = 'No se pudo obtener tu ubicación: usa el centro del mapa.'; }, { enableHighAccuracy: true, timeout: 12000 });
    } else status.textContent = 'Mueve el mapa para poner el punto de mira donde está.';
  }));
  el.querySelectorAll<HTMLButtonElement>('.rep-opt').forEach((b) => b.addEventListener('click', async () => {
    if (map.getZoom() < 11 && where === 'center') {
      status.textContent = 'Acerca más el mapa para situar el aviso con precisión.';
      status.classList.add('warn-text');
      return;
    }
    const [lon, lat] = where === 'gps' && gps ? gps : [map.getCenter().lng, map.getCenter().lat];
    el.querySelectorAll<HTMLButtonElement>('.rep-opt').forEach((x) => (x.disabled = true));
    status.textContent = 'Enviando…';
    try {
      const r = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: b.dataset.kind, lon, lat }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      status.classList.remove('warn-text');
      el.innerHTML = `<p class="pill-note big">${iconSvg('thumbUp', 20)} ${j.merged ? 'Ya estaba avisado: has sumado una confirmación.' : '¡Gracias! Tu aviso ya está en el mapa.'}</p>`;
      cross.remove();
      done();
      setTimeout(() => sheet.isOpen && sheet.close(), 2200);
    } catch (e) {
      status.textContent = `No se pudo enviar: ${(e as Error).message}`;
      el.querySelectorAll<HTMLButtonElement>('.rep-opt').forEach((x) => (x.disabled = false));
    }
  }));
  app.append(cross);
  const prevClose = sheet.onClose;
  sheet.onClose = () => {
    cross.remove();
    sheet.onClose = prevClose;
    prevClose();
  };
  sheet.show('Avisar a otros conductores', 'Radar móvil, control, accidente…', el);
  if (map.getZoom() < 11) status.textContent = 'Acerca el mapa al lugar y pon el punto de mira encima.';
}
