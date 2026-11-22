// Generates every HTML entry point (map, content pages, one page per road) and pages.json for Vite.
// Road pages are built from the live data the worker has written (cameras, radars, stretches).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://rutaviva.aminox.dev';
const LIVE = process.env.RUTAVIVA_LIVE ?? join(homedir(), 'docker/rutaviva/data/worker/live');

interface Page { path: string; title: string; description: string; body: string; script?: string; kind?: string; jsonld?: object; noindex?: boolean }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const LOGO = `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0a84ff"/><path d="M10 25c4-6 2-9 6-13s7-3 7-3" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="23" cy="9" r="3.2" fill="#ffd60a"/><circle cx="10" cy="25" r="2.4" fill="#fff"/></svg>`;

function head(p: Page): string {
  const url = `${SITE}${p.path}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
${p.noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ruta viva">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script>try{var t=localStorage.getItem('rutaviva-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
${p.jsonld ? `<script type="application/ld+json">${JSON.stringify(p.jsonld)}</script>` : ''}
</head>`;
}

const NAV = [['/', 'Mapa'], ['/gasolineras/', 'Gasolineras'], ['/recarga/', 'Recarga'], ['/zbe/', 'ZBE'], ['/carreteras/', 'Carreteras']] as const;

function shell(p: Page): string {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${p.path === href || (href !== '/' && p.path.startsWith(href)) ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `${head(p)}
<body class="page">
<a class="skip" href="#main">Saltar al contenido</a>
<header class="site-head"><a class="site-brand" href="/">${LOGO}<span>Ruta viva</span></a><nav aria-label="Secciones">${nav}</nav>
<button class="icon-btn theme-btn" type="button" aria-label="Cambiar tema"></button></header>
<main id="main" class="content" data-page="${esc(p.kind ?? '')}">
${p.body}
</main>
<footer class="site-foot">
<p><b>Ruta viva</b> reúne datos abiertos oficiales: DGT (Punto de Acceso Nacional), Servei Català de Trànsit, Tráfico del Gobierno Vasco, Ministerio para la Transición Ecológica, REVE (Red Eléctrica), Instituto Geográfico Nacional y OpenStreetMap. No es una web oficial ni está vinculada a esos organismos.</p>
<nav aria-label="Información legal"><a href="/acerca/">Acerca de</a><a href="/fuentes/">Fuentes y licencias</a><a href="/aviso-legal/">Aviso legal</a><a href="/privacidad/">Privacidad</a><a href="/terminos/">Términos</a><a href="#" data-consent-open>Cookies</a><a href="https://github.com/amintikk/rutaviva">Código</a></nav>
</footer>
<script type="module" src="${p.script ?? '/src/page.ts'}"></script>
</body>
</html>
`;
}

function mapPage(): string {
  const p: Page = {
    path: '/', title: 'Ruta viva · El estado de las carreteras de España en directo',
    description: 'Mapa en directo de las carreteras de España: accidentes, cortes, obras, nieve, cámaras de la DGT, radares, precios de todas las gasolineras con su historia, recarga eléctrica con estado y precio, y zonas de bajas emisiones.',
    body: '', jsonld: { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Ruta viva', url: `${SITE}/`, applicationCategory: 'TravelApplication', operatingSystem: 'Web', inLanguage: 'es', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: 'Mapa en directo de las carreteras de España con datos abiertos oficiales.' },
  };
  return `${head(p)}
<body>
<h1 class="sr-only">Ruta viva: el estado de las carreteras de España en directo</h1>
<div id="app"><div id="map" role="region" aria-label="Mapa"></div></div>
<noscript><p style="padding:20px">Ruta viva necesita JavaScript para mostrar el mapa. Puedes consultar las <a href="/carreteras/">carreteras</a>, las <a href="/gasolineras/">gasolineras</a> y los <a href="/zbe/">zonas de bajas emisiones</a>.</p></noscript>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- content

const prose = (s: string) => `<article class="prose">${s}</article>`;

const STATIC: Page[] = [
  {
    path: '/gasolineras/', kind: 'fuel', title: 'Precio de la gasolina y el diésel en España, día a día desde 2007 · Ruta viva',
    description: 'La historia del precio de los carburantes en España desde 2007 con el precio de cada gasolinera cada día: qué día de la semana es más barato repostar, qué marcas son más baratas y cómo cambia por provincia.',
    body: `<header class="page-hero"><p class="eyebrow">Gasolineras</p><h1>El precio de repostar, día a día desde 2007</h1>
<p class="lede">Cada día, las más de 11.000 gasolineras de España comunican su precio al Ministerio para la Transición Ecológica. Aquí está toda esa historia, con la mediana de todas ellas.</p></header>
<section class="card"><div class="card-head"><h2>Precio mediano en España</h2><div class="seg" id="range"></div></div><div id="national" class="chart-box"><p class="muted">Cargando…</p></div><p class="muted small" id="national-note"></p></section>
<div class="grid-2">
<section class="card"><h2>¿Qué día sale más barato?</h2><p class="muted small">Diferencia media de cada día con el precio de esa misma semana en la misma gasolinera, último año.</p><div id="weekday"></div></section>
<section class="card"><h2>Marcas más baratas y más caras</h2><p class="muted small">Precio mediano de gasolina 95 en los últimos 30 días, marcas con al menos 40 estaciones.</p><div id="brands"></div></section>
</div>
<section class="card"><h2>Por provincia</h2><p class="muted small">Precio mediano de gasolina 95 y diésel en los últimos 30 días.</p><div id="provinces"></div></section>
<section class="card cta"><h2>Encuentra la más barata cerca de ti</h2><p>En el mapa, activa <b>Gasolineras</b>: verde las más baratas, rojo las más caras. Toca una para ver su historia.</p><a class="btn" href="/?capas=fuel">Abrir el mapa de gasolineras</a></section>`,
  },
  {
    path: '/recarga/', kind: 'ev', title: 'Puntos de recarga averiados y precio de cargar el coche eléctrico · Ruta viva',
    description: 'Cuántos puntos de recarga públicos están averiados en España, qué operadores tienen más cargadores fuera de servicio y cuánto cuesta cargar según la potencia, con los datos en tiempo real de REVE (Red Eléctrica).',
    body: `<header class="page-hero"><p class="eyebrow">Recarga eléctrica</p><h1>¿Funcionan los cargadores?</h1>
<p class="lede">Desde 2023 los operadores de recarga deben comunicar el estado y el precio de cada punto. Cada noche recorremos el mapa oficial REVE y contamos cuántos están libres, en uso o averiados.</p></header>
<section class="stat-row" id="ev-stats"><p class="muted">Cargando…</p></section>
<section class="card"><h2>Operadores con más puntos averiados</h2><p class="muted small">Porcentaje de ubicaciones marcadas como «fuera de servicio» en el último recorrido. Operadores con al menos 25 ubicaciones.</p><div id="ev-ops"></div></section>
<section class="card"><h2>Lo que cuesta cargar</h2><p class="muted small">Precio por kWh publicado por los operadores, IVA incluido, últimos 14 días.</p><div id="ev-prices"></div></section>
<section class="card"><h2>Evolución</h2><div id="ev-hist"></div></section>
<section class="card cta"><h2>Míralo en el mapa</h2><p>Activa <b>Recarga</b> y acércate: los puntos muestran si están libres, ocupados o averiados ahora mismo, con su precio.</p><a class="btn" href="/?capas=ev">Abrir el mapa de recarga</a></section>`,
  },
  {
    path: '/zbe/', kind: 'zbe', title: 'Zonas de bajas emisiones (ZBE) de España: mapa y qué etiquetas pueden entrar · Ruta viva',
    description: 'Todas las zonas de bajas emisiones publicadas por la DGT: mapa, horarios y qué etiquetas ambientales tienen restringido el acceso en cada ciudad.',
    body: `<header class="page-hero"><p class="eyebrow">Zonas de bajas emisiones</p><h1>¿Puedo entrar con mi coche?</h1>
<p class="lede">Elige tu etiqueta ambiental y mira en qué zonas de bajas emisiones tienes restricciones según la información que los ayuntamientos han enviado a la DGT.</p></header>
<section class="card"><div class="card-head"><h2>Tu etiqueta</h2><div class="seg" id="sticker"></div></div><div id="zbe-list"><p class="muted">Cargando…</p></div>
<p class="muted small">Los ficheros de la DGT no siempre detallan las excepciones (residentes, horarios, aparcamientos o vehículos de servicio). Antes de ir, confirma las normas en la web del ayuntamiento.</p></section>
<section class="card cta"><h2>En el mapa</h2><a class="btn" href="/?capas=zbe">Ver las zonas en el mapa</a></section>`,
  },
  {
    path: '/acerca/', kind: 'about', title: 'Acerca de Ruta viva',
    description: 'Qué es Ruta viva, de dónde salen sus datos, cada cuánto se actualizan y qué limitaciones tienen.',
    body: prose(`<h1>Acerca de Ruta viva</h1>
<p class="lede">Ruta viva junta en un mapa todo lo que las administraciones publican en abierto sobre las carreteras de España: lo que pasa ahora, lo que vigila la DGT, cuánto cuesta repostar o cargar y dónde no puedes entrar con tu coche.</p>
<h2>Qué se actualiza y cada cuánto</h2>
<ul><li><b>Incidencias</b> (DGT, Cataluña y País Vasco): cada 3 minutos.</li><li><b>Paneles de mensaje variable</b>: cada 3 minutos.</li>
<li><b>Cámaras</b>: la imagen se pide a la DGT como mucho cada 2 minutos; la lista de cámaras, cada 6 horas.</li>
<li><b>Gasolineras</b>: precios cada 30 minutos; historia diaria desde 2007.</li>
<li><b>Recarga</b>: estaciones cada día; estado y precio en tiempo real al consultarlas; recorrido completo cada noche.</li>
<li><b>Radares, tramos y zonas de bajas emisiones</b>: cada pocas horas. Los radares combinan la lista oficial de la DGT con los que la comunidad de OpenStreetMap ha cartografiado (Cataluña, País Vasco, radares municipales y de semáforo); los segundos se distinguen en el mapa y en su ficha.</li><li><b>Terremotos</b>: cada 10 minutos.</li></ul>
<h2>Lo que hay que saber</h2>
<ul><li>Solo aparece lo que publican los organismos. Un accidente que la DGT no ha registrado no sale, y algunos avisos siguen activos después de resolverse.</li>
<li>Las incidencias se clasifican automáticamente a partir de los códigos del estándar europeo DATEX II.</li>
<li>Los radares oficiales son los que publica la DGT; los radares móviles y de helicóptero no se publican.</li>
<li>Los tiempos de viaje son sin tráfico, calculados con un servidor propio sobre OpenStreetMap.</li>
<li>Los precios de recarga y su estado los publican los propios operadores en REVE; si un operador no los envía, aparece «sin datos».</li></ul>
<p>Más detalle técnico en <a href="/fuentes/">Fuentes y licencias</a>. El código es abierto: <a href="https://github.com/amintikk/rutaviva">github.com/amintikk/rutaviva</a>.</p>`),
  },
  {
    path: '/fuentes/', kind: 'about', title: 'Fuentes y licencias · Ruta viva',
    description: 'Los conjuntos de datos abiertos que usa Ruta viva, sus licencias y cómo se citan.',
    body: prose(`<h1>Fuentes y licencias</h1>
<table class="sources"><thead><tr><th>Datos</th><th>Origen</th><th>Licencia</th></tr></thead><tbody>
<tr><td>Incidencias, cámaras, paneles, radares, tramos INVIVE, tramos de riesgo para motos, zonas de bajas emisiones</td><td>Dirección General de Tráfico, <a href="https://nap.dgt.es/">Punto de Acceso Nacional de tráfico y movilidad</a> (DATEX II)</td><td>CC BY 4.0</td></tr>
<tr><td>Incidencias de Cataluña</td><td>Servei Català de Trànsit, vía el Punto de Acceso Nacional</td><td>CC BY 4.0</td></tr>
<tr><td>Incidencias del País Vasco</td><td>Dirección de Tráfico del Gobierno Vasco, vía el Punto de Acceso Nacional</td><td>CC BY 4.0</td></tr>
<tr><td>Precios de carburantes (actuales e históricos desde 2007)</td><td>Ministerio para la Transición Ecológica y el Reto Demográfico, <a href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/">servicio REST de precios</a></td><td>Reutilización de la información del sector público (Ley 37/2007), con cita de la fuente</td></tr>
<tr><td>Estaciones de recarga (datos fijos)</td><td>MITERD, vía el Punto de Acceso Nacional</td><td>CC BY 4.0</td></tr>
<tr><td>Estado y precio de los puntos de recarga</td><td><a href="https://www.mapareve.es/">REVE</a>, Red Eléctrica, con datos de los operadores (Orden TED/445/2023)</td><td>Consulta del mapa público; se cachea y se consulta con moderación</td></tr>
<tr><td>Radares que no están en la lista de la DGT y límite de velocidad de cada radar</td><td>© colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (elementos <code>highway=speed_camera</code>)</td><td>ODbL</td></tr>
<tr><td>Terremotos</td><td><a href="https://www.ign.es/">Instituto Geográfico Nacional</a></td><td>CC BY 4.0</td></tr>
<tr><td>Mapa base y rutas</td><td>© colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL), teselas de <a href="https://protomaps.com">Protomaps</a>, rutas con <a href="https://valhalla.github.io/valhalla/">Valhalla</a></td><td>ODbL</td></tr>
<tr><td>Relieve</td><td><a href="https://mapterhorn.com/attribution">Mapterhorn</a></td><td>Varias abiertas</td></tr>
<tr><td>Buscador</td><td>CartoCiudad (IGN)</td><td>CC BY 4.0</td></tr></tbody></table>
<p>Ruta viva no es una web oficial: no está vinculada ni patrocinada por ninguno de estos organismos. Los datos se muestran como se publican, con las transformaciones descritas en <a href="/acerca/">Acerca de</a>.</p>`),
  },
  {
    path: '/aviso-legal/', kind: 'legal', title: 'Aviso legal · Ruta viva', description: 'Titular, objeto y condiciones de Ruta viva.',
    body: prose(`<h1>Aviso legal</h1><p><b>Titular:</b> Amin Tahtah Toumi. Contacto: <a href="mailto:amintahtahtoumi@gmail.com">amintahtahtoumi@gmail.com</a>.</p>
<p>Ruta viva es un proyecto personal, sin ánimo de lucro, que muestra datos abiertos de las administraciones públicas sobre las carreteras de España. No es una web oficial y no sustituye a la información oficial de la DGT, de las administraciones autonómicas ni de los ayuntamientos.</p>
<p>La información puede contener errores, retrasos u omisiones procedentes de las fuentes o de su tratamiento. Antes de tomar decisiones de viaje importantes, consulta las fuentes oficiales y respeta siempre la señalización y las indicaciones de los agentes.</p>
<p>El código fuente se publica con licencia MIT. Los datos mantienen la licencia de su origen, detallada en <a href="/fuentes/">Fuentes y licencias</a>.</p>`),
  },
  {
    path: '/privacidad/', kind: 'legal', title: 'Política de privacidad · Ruta viva', description: 'Qué datos recoge Ruta viva y cómo se tratan.',
    body: prose(`<h1>Política de privacidad</h1><p><b>Responsable:</b> Amin Tahtah Toumi, <a href="mailto:amintahtahtoumi@gmail.com">amintahtahtoumi@gmail.com</a>.</p>
<h2>Sin cuenta y sin datos personales</h2><p>Ruta viva no tiene registro ni formularios. Las búsquedas de lugares se envían a CartoCiudad (IGN) a través de nuestro servidor, sin tu dirección IP. Tu ubicación, si pulsas «Mi ubicación», se usa solo en tu navegador para centrar el mapa o calcular una ruta, y no se guarda.</p>
<h2>Medición de audiencia</h2><p>Solo si lo aceptas, usamos Google Analytics 4 con IP anonimizada para saber cuántas personas usan la web y qué partes. Si lo rechazas, no se instala ninguna cookie de medición. Puedes cambiar de opinión en «Cookies», al pie de cada página.</p>
<h2>Preferencias guardadas en tu navegador</h2><p>Guardamos en el almacenamiento local de tu navegador el tema, las capas activas y el combustible elegido. No salen de tu dispositivo.</p>
<h2>Registros del servidor</h2><p>El servidor no guarda registros de acceso con direcciones IP más allá de lo necesario para proteger el servicio frente a abusos.</p>
<h2>Tus derechos</h2><p>Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo al correo anterior, y reclamar ante la Agencia Española de Protección de Datos.</p>`),
  },
  {
    path: '/terminos/', kind: 'legal', title: 'Términos de uso · Ruta viva', description: 'Condiciones de uso de Ruta viva.',
    body: prose(`<h1>Términos de uso</h1><p>Ruta viva se ofrece gratis, tal cual, sin garantía de exactitud, disponibilidad ni actualización. No uses la web mientras conduces: consúltala antes de salir o pide a un acompañante que lo haga.</p>
<p>Puedes enlazar cualquier página y reutilizar los datos respetando la licencia de cada fuente. No está permitido descargar de forma masiva o automatizada los recursos de la web (imágenes de cámaras, teselas o consultas en tiempo real): usa directamente las fuentes oficiales enlazadas en <a href="/fuentes/">Fuentes y licencias</a>.</p>`),
  },
];

// ---------------------------------------------------------------- roads

interface F { geometry: { type: string; coordinates: number[] | number[][] }; properties: Record<string, unknown> }
function readLive(name: string): F[] {
  const f = join(LIVE, `${name}.json`);
  if (!existsSync(f)) return [];
  try { return (JSON.parse(readFileSync(f, 'utf8')) as { features: F[] }).features; } catch { return []; }
}

function provName(p: string): string {
  if (!p) return '';
  let s = p.trim();
  const inv = /^(.*?),\s*(A|O|La|Las|Los|El|Illes)$/i.exec(s);
  if (inv) s = `${inv[2]} ${inv[1]}`;
  return s.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|El|Y)\b(?!$)/g, (w, _a, i: number) => (i === 0 ? w : w.toLowerCase()));
}

const ROAD_RE = /^(AP|A|N|E|M|R|C|CV|CM|CL|EX|MU|AG|AC|PO|LU|OU|GR|SE|MA|CA|HU|AL|CO|J|JA|H|BA|CC|SA|ZA|LE|BU|P|VA|SG|AV|SO|TO|CR|GU|CU|TE|Z|L|LO|NA|GI|BI|SS|VI|B|BP|T|TF|GC|IB|PM|V|CS|AS|S|O)-?\d{1,4}[A-Z]?$/;

function roadPages(): Page[] {
  const roads = new Map<string, { cams: F[]; radars: F[]; stretches: F[] }>();
  const add = (road: unknown, k: 'cams' | 'radars' | 'stretches', f: F) => {
    const r = String(road ?? '').toUpperCase().replace(/\s+/g, '');
    if (!ROAD_RE.test(r)) return;
    const e = roads.get(r) ?? { cams: [], radars: [], stretches: [] };
    e[k].push(f);
    roads.set(r, e);
  };
  for (const f of readLive('cameras')) add(f.properties.road, 'cams', f);
  for (const f of readLive('radars')) add(f.properties.road, 'radars', f);
  for (const f of readLive('invive')) add(f.properties.road, 'stretches', f);
  const pages: Page[] = [];
  const list: { road: string; slug: string; cams: number; radars: number; stretches: number }[] = [];
  const kmOf = (f: F) => Number(f.properties.km ?? 0);
  for (const [road, e] of roads) {
    const n = e.cams.length + e.radars.length;
    if (n < 3) continue;
    const s = slug(road);
    list.push({ road, slug: s, cams: e.cams.length, radars: e.radars.length, stretches: e.stretches.length });
    const provs = [...new Set([...e.cams, ...e.radars].map((f) => provName(String(f.properties.prov ?? ''))).filter(Boolean))].slice(0, 8);
    const fijos = e.radars.filter((f) => f.properties.kind === 'fijo').sort((a, b) => kmOf(a) - kmOf(b));
    const tramos = e.radars.filter((f) => f.properties.kind === 'tramo').sort((a, b) => kmOf(a) - kmOf(b));
    const cams = [...e.cams].sort((a, b) => kmOf(a) - kmOf(b));
    const km = (v: unknown) => (v == null ? '' : `km ${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 })}`);
    const body = `<header class="page-hero"><p class="eyebrow">Carretera</p><h1>${esc(road)} en directo</h1>
<p class="lede">Estado ahora, ${e.cams.length} cámaras de la DGT${e.radars.length ? `, ${e.radars.length} radares` : ''}${e.stretches.length ? ` y ${e.stretches.length} tramos de vigilancia` : ''}${provs.length ? ` a su paso por ${esc(provs.join(', '))}` : ''}.</p>
<p><a class="btn" href="/?carretera=${encodeURIComponent(road)}&capas=traffic,cameras,radars">Ver la ${esc(road)} en el mapa</a></p></header>
<section class="card" id="road-live" data-road="${esc(road)}"><h2>Ahora en la ${esc(road)}</h2><p class="muted">Cargando avisos…</p></section>
${cams.length ? `<section class="card"><h2>Cámaras (${cams.length})</h2><div class="cam-grid" data-road="${esc(road)}">${cams.slice(0, 60).map((f) => `<figure data-cam="${esc(f.properties.id)}"><img loading="lazy" alt="Cámara de la ${esc(road)} ${esc(km(f.properties.km))}" src="/cam/${esc(f.properties.id)}.jpg"><figcaption>${esc(km(f.properties.km))}${f.properties.dest ? ` · hacia ${esc(f.properties.dest)}` : ''}</figcaption></figure>`).join('')}</div></section>` : ''}
${fijos.length || tramos.length ? `<section class="card"><h2>Radares</h2><table class="plain"><thead><tr><th>Tipo</th><th>Situación</th><th>Provincia</th></tr></thead><tbody>
${[...fijos.map((f) => `<tr><td>Fijo</td><td>${esc(km(f.properties.km))}</td><td>${esc(provName(String(f.properties.prov ?? '')))}</td></tr>`), ...tramos.map((f) => `<tr><td>Tramo${f.properties.len ? ` (${esc(String(f.properties.len).replace('.', ','))} km)` : ''}</td><td>${esc(km(f.properties.km))}${f.properties.km2 != null ? ` a ${esc(km(f.properties.km2))}` : ''}</td><td>${esc(provName(String(f.properties.prov ?? '')))}</td></tr>`)].join('')}
</tbody></table><p class="muted small">Ubicaciones publicadas por la DGT. No incluye radares móviles.</p></section>` : ''}
${e.stretches.length ? `<section class="card"><h2>Tramos de vigilancia intensificada (INVIVE)</h2><p>${e.stretches.sort((a, b) => kmOf(a) - kmOf(b)).map((f) => `<span class="chip">${esc(km(f.properties.km))}${f.properties.km2 != null ? ` – ${esc(String(f.properties.km2).replace('.', ','))}` : ''}</span>`).join(' ')}</p></section>` : ''}`;
    pages.push({
      path: `/carretera/${s}/`, kind: 'road', title: `${road} hoy: estado, cámaras y radares en directo · Ruta viva`,
      description: `Estado de la ${road} ahora mismo: accidentes, obras y cortes, ${e.cams.length} cámaras de la DGT en directo${e.radars.length ? ` y ${e.radars.length} radares` : ''}.`, body,
      jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: `${road} en directo`, url: `${SITE}/carretera/${s}/`, isPartOf: { '@type': 'WebSite', name: 'Ruta viva', url: SITE } },
    });
  }
  const order = (r: string) => { const m = /^([A-Z]+)-?(\d+)/.exec(r); return m ? [['AP', 'A', 'N', 'E'].indexOf(m[1]!) + 1 || 9, m[1]!, Number(m[2])] as const : [9, r, 0] as const; };
  list.sort((a, b) => { const x = order(a.road); const y = order(b.road); return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2]; });
  pages.push({
    path: '/carreteras/', kind: 'roads', title: 'Carreteras de España: estado, cámaras y radares · Ruta viva',
    description: `Estado en directo, cámaras de la DGT y radares de ${list.length} carreteras de España, de la A-1 a la última nacional.`,
    body: `<header class="page-hero"><p class="eyebrow">Carreteras</p><h1>Cada carretera, en directo</h1><p class="lede">${list.length} carreteras con cámaras o radares de la DGT. Elige una para ver su estado, sus cámaras y sus radares.</p>
<label class="filter"><span class="sr-only">Filtrar carreteras</span><input id="road-filter" type="search" placeholder="Filtra: A-6, N-340, AP-7…" autocomplete="off"></label></header>
<section class="road-list">${list.map((r) => `<a href="/carretera/${r.slug}/" data-road="${esc(r.road)}"><b>${esc(r.road)}</b><small>${r.cams} cámaras${r.radars ? ` · ${r.radars} radares` : ''}</small></a>`).join('')}</section>`,
  });
  return pages;
}

// ---------------------------------------------------------------- write

const written: string[] = [];
function write(path: string, html: string): void {
  const file = path === '/' ? 'index.html' : path === '/404/' ? '404.html' : join(path.slice(1), 'index.html');
  const full = join(ROOT, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
  written.push(file);
}

for (const dir of ['carretera']) if (existsSync(join(ROOT, dir))) rmSync(join(ROOT, dir), { recursive: true });
write('/', mapPage());
const all = [...STATIC, ...roadPages()];
for (const p of all) write(p.path, shell(p));
write('/404/', shell({ path: '/404/', kind: 'legal', noindex: true, title: 'Página no encontrada · Ruta viva', description: 'Esta página no existe.', body: prose('<h1>Por aquí no se pasa</h1><p>Esta página no existe o ha cambiado de sitio. Vuelve al <a href="/">mapa</a> o busca una <a href="/carreteras/">carretera</a>.</p>') }));
writeFileSync(join(ROOT, 'pages.json'), JSON.stringify(written));
writeFileSync(join(ROOT, 'sitemap-pages.json'), JSON.stringify(['/', ...all.map((p) => p.path)]));
console.log(`pages: ${written.length} (${all.filter((p) => p.kind === 'road').length} carreteras)`);
