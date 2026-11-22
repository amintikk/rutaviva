// Opening hours of fuel stations as the Ministry publishes them: "L-D: 24H", "L-V: 06:00-22:00; S-D: 07:00-22:00",
// "L-S: 7:00-14:00 y 16:00-20:00". Days: L M X J V S D.
const DAYS = 'LMXJVSD';
const CANARY = /palmas|tenerife/i;

type Range = [number, number]; // minutes from midnight; end may pass 24 h

/** Weekday ranges, or null when the text cannot be read. Index 0 = Monday. */
export function parseHours(text: string): Range[][] | null {
  const week: Range[][] = [[], [], [], [], [], [], []];
  const mentioned = new Set<number>();
  for (const part of text.split(';')) {
    const m = /^\s*([LMXJVSD](?:\s*-\s*[LMXJVSD])?(?:\s*,\s*[LMXJVSD](?:\s*-\s*[LMXJVSD])?)*)\s*:\s*(.+)$/.exec(part);
    if (!m) { if (part.trim()) return null; continue; }
    const days: number[] = [];
    for (const g of m[1]!.split(',')) {
      const [a, b] = g.split('-').map((x) => DAYS.indexOf(x.trim()));
      if (a! < 0 || (b !== undefined && b < 0)) return null;
      for (let d = a!; ; d = (d + 1) % 7) { days.push(d); if (b === undefined || d === b) break; }
    }
    const spec = m[2]!.trim().toUpperCase();
    const ranges: Range[] = [];
    if (/^24\s*H/.test(spec)) ranges.push([0, 1440]);
    else {
      for (const r of spec.split(/\s*(?:Y|,)\s*/)) {
        const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(r.trim());
        if (!t) return null;
        const a = +t[1]! * 60 + +t[2]!;
        let b = +t[3]! * 60 + +t[4]!;
        if (b === 23 * 60 + 59) b = 1440;
        if (b <= a) b += 1440; // closes after midnight (00:00 included)
        ranges.push([a, b]);
      }
    }
    for (const d of days) { week[d]!.push(...ranges); mentioned.add(d); }
  }
  // A schedule that names only Monday ("L: 06:00-22:00") is a data-entry slip, not a Monday-only station: unknown.
  if (mentioned.size === 1 && mentioned.has(0)) return null;
  return mentioned.size ? week : null;
}

function localNow(prov: string, now: Date): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CANARY.test(prov) ? 'Atlantic/Canary' : 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')), min: +get('hour') * 60 + +get('minute') };
}

const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface OpenState { open: boolean | null; text: string; always?: boolean }

/** Whether it is open now and the next change ("Cierra a las 22:00", "Abre mañana a las 07:00"). */
export function openState(text: string, prov = '', now = new Date()): OpenState {
  const week = parseHours(text);
  if (!week) return { open: null, text: '' };
  const { day, min } = localNow(prov, now);
  if (week.every((d) => d.some(([a, b]) => a === 0 && b >= 1440))) return { open: true, text: 'Abierta 24 horas', always: true };
  // Ranges that started yesterday and run past midnight count too.
  const yesterday = week[(day + 6) % 7]!.map(([a, b]) => [a - 1440, b - 1440] as Range);
  const today = [...yesterday, ...week[day]!];
  const cur = today.find(([a, b]) => a <= min && min < b);
  if (cur) {
    // Chain ranges that continue the current one (24 h over several days).
    let end = cur[1];
    for (let k = 1; k < 7 && end >= 1440 * k; k++) {
      const nxt = week[(day + k) % 7]!.find(([a]) => a === 0);
      if (!nxt) break;
      end = 1440 * k + nxt[1];
    }
    if (end - min > 1440 * 2) return { open: true, text: 'Abierta 24 horas', always: true };
    return { open: true, text: end > 1440 ? `Abierta · cierra ${end > 2880 ? 'pasado mañana' : 'mañana'} a las ${hhmm(end)}` : `Abierta · cierra a las ${hhmm(end)}` };
  }
  for (let k = 0; k < 7; k++) {
    const starts = week[(day + k) % 7]!.map(([a]) => a).filter((a) => k > 0 || a > min).sort((x, y) => x - y);
    if (starts.length) {
      const when = k === 0 ? '' : k === 1 ? 'mañana ' : `el ${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][(day + k) % 7]} `;
      return { open: false, text: `Cerrada · abre ${when}a las ${hhmm(starts[0]!)}` };
    }
  }
  return { open: false, text: 'Cerrada' };
}
