// Cookie consent for Google Analytics 4. Nothing from Google loads, and no cookie is set,
// until the visitor accepts. The choice is kept in localStorage; withdrawing it deletes the _ga cookies.
const KEY = 'rutaviva-consent';
const GA = import.meta.env.VITE_GA4_ID as string | undefined;

type Choice = 'yes' | 'no' | null;

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

function store(v: 'yes' | 'no'): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* blocked storage: the banner will ask again next time */
  }
}

let loaded = false;
function loadGa(): void {
  if (!GA || loaded) return;
  loaded = true;
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', GA, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA}`;
  document.head.append(s);
}

function clearGaCookies(): void {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]!.trim();
    if (!name.startsWith('_ga')) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
  }
}

/** Send a GA4 event if measurement is on. */
export function track(name: string, params: Record<string, unknown> = {}): void {
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (loaded && g) g('event', name, params);
}

let banner: HTMLElement | null = null;

function show(): void {
  if (!GA) return;
  banner?.remove();
  const el = document.createElement('section');
  el.className = 'consent';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Cookies');
  el.innerHTML = `<h2>¿Medimos tu visita?</h2><p>Con tu permiso, Google Analytics nos dice cuántas personas usan Ruta viva y qué partes. Sin él no se instala ninguna cookie. <a href="/privacidad/">Política de privacidad</a>.</p><div class="row"><button class="btn ghost" data-v="no" type="button">Rechazar</button><button class="btn" data-v="yes" type="button">Aceptar</button></div>`;
  el.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v as 'yes' | 'no' | undefined;
    if (!v) return;
    store(v);
    if (v === 'yes') loadGa();
    else {
      clearGaCookies();
      if (loaded) location.reload(); // unload gtag
    }
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  });
  document.body.append(el);
  banner = el;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
}

export function initConsent(): void {
  const c = read();
  if (c === 'yes') loadGa();
  else if (c === null) setTimeout(show, 1200);
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-consent-open]')) show();
  });
}
