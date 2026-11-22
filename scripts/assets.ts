// Icons and the social preview image (run with: FONTCONFIG_FILE=scripts/fonts/fonts.conf node scripts/assets.ts).
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const LOGO = (s: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${s}" height="${s}"><rect width="32" height="32" rx="9" fill="#0a84ff"/><path d="M10 25c4-6 2-9 6-13s7-3 7-3" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="23" cy="9" r="3.2" fill="#ffd60a"/><circle cx="10" cy="25" r="2.4" fill="#fff"/></svg>`;
writeFileSync('public/icon.svg', LOGO(32));
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
  await sharp(Buffer.from(LOGO(size))).png().toFile(`public/${name}`);
}
writeFileSync('public/site.webmanifest', JSON.stringify({
  name: 'Ruta viva', short_name: 'Ruta viva', description: 'El estado de las carreteras de España en directo.', start_url: '/', display: 'standalone',
  background_color: '#f2f2f7', theme_color: '#0a84ff', lang: 'es',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
}, null, 1));

// Social image: a stylised night map with roads and live markers.
const dots = [
  [700, 210, '#ff3b30'], [820, 330, '#f08a24'], [960, 250, '#0a84ff'], [1040, 420, '#5856d6'], [760, 470, '#34c759'], [900, 520, '#ff2d55'], [1110, 160, '#00a6a6'],
] as const;
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101114"/><stop offset="1" stop-color="#1d2230"/></linearGradient>
<radialGradient id="glow" cx="0.72" cy="0.45" r="0.6"><stop offset="0" stop-color="#0a84ff" stop-opacity="0.28"/><stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>
<g fill="none" stroke-linecap="round">
<path d="M560 640 C 640 520, 700 420, 820 330 S 1020 200, 1220 120" stroke="#8c6f35" stroke-width="14"/>
<path d="M560 640 C 640 520, 700 420, 820 330 S 1020 200, 1220 120" stroke="#fcd27e" stroke-width="7"/>
<path d="M620 90 C 700 200, 760 300, 760 470 S 840 600, 900 660" stroke="#4a4c53" stroke-width="9"/>
<path d="M1220 470 C 1100 440, 1000 430, 900 520 S 700 600, 620 640" stroke="#4a4c53" stroke-width="7"/>
<path d="M960 250 L 1040 420" stroke="#ff2d55" stroke-width="6" stroke-dasharray="14 10" opacity="0.9"/>
</g>
${dots.map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="21" fill="#fff"/><circle cx="${x}" cy="${y}" r="16" fill="${c}"/>`).join('')}
<g transform="translate(72 88)">${LOGO(88).replace('<svg ', '<svg x="0" y="0" ')}</g>
<text x="72" y="300" font-family="Inter" font-weight="800" font-size="92" fill="#fff" letter-spacing="-3">Ruta viva</text>
<text x="74" y="362" font-family="Inter" font-weight="500" font-size="34" fill="#c7c7cc">Las carreteras de España, en directo</text>
<text x="74" y="520" font-family="Inter" font-weight="700" font-size="24" fill="#8e8e93">Incidencias · Cámaras · Radares · Gasolineras · Recarga · ZBE</text>
</svg>`;
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile('public/og.png');
console.log('assets ok');
