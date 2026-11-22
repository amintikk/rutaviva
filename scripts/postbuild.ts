// After vite build: sitemap.xml and robots.txt for every generated page.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SITE = 'https://rutaviva.aminox.dev';
const root = resolve(import.meta.dirname, '..');
const paths = JSON.parse(readFileSync(resolve(root, 'sitemap-pages.json'), 'utf8')) as string[];
const today = new Date().toISOString().slice(0, 10);
const prio = (p: string) => (p === '/' ? '1.0' : p.startsWith('/carretera/') ? '0.6' : ['/aviso-legal/', '/privacidad/', '/terminos/'].includes(p) ? '0.2' : '0.8');
const freq = (p: string) => (p === '/' || p.startsWith('/carretera/') ? 'hourly' : ['/gasolineras/', '/recarga/'].includes(p) ? 'daily' : 'monthly');
writeFileSync(resolve(root, 'dist/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod><changefreq>${freq(p)}</changefreq><priority>${prio(p)}</priority></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(resolve(root, 'dist/robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /route/\nDisallow: /cam/\nDisallow: /live/\nDisallow: /tiles/\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`sitemap: ${paths.length} URLs`);
