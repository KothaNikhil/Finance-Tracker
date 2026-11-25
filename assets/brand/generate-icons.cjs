#!/usr/bin/env node
/**
 * Finance Tracker brand icon generator — "Spend Ring + Rising ₹" (concept D in
 * ui-mocks/icon-concepts.html).
 *
 * This file is the single source of truth for the app icon. It builds every
 * SVG variant in code and rasterises the PNGs with Playwright (system Edge or
 * Chrome; no browser download needed).
 *
 *   node assets/brand/generate-icons.cjs
 *
 * Outputs: mobile/assets/images/*, web/public/*, ui-mocks/assets/img/brand-mark*.png
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const COLORS = {
  gradFrom: '#16A08C',
  gradTo: '#0A564F',
  white: '#FFFFFF',
  mint: '#7FE3B4',
};

/* ---------- SVG building blocks (1024 × 1024 design grid) ---------- */

const defs = `
  <defs>
    <linearGradient id="ftBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.gradFrom}"/>
      <stop offset="1" stop-color="${COLORS.gradTo}"/>
    </linearGradient>
    <radialGradient id="ftGlow" cx="0.3" cy="0.22" r="0.8">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".18"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

/**
 * Ring (category donut) + ₹ whose top bar becomes a rising arrow that breaks
 * out through a gap in the ring. Ring: r 262, circumference ≈ 1646, 1° ≈ 4.573,
 * gap 15°–60° (clockwise from 12 o'clock) for the arrow.
 */
function glyph({ mono = false } = {}) {
  const w = COLORS.white;
  const accent = mono ? w : COLORS.mint;
  const faded = mono ? 'stroke-opacity=".45"' : 'stroke-opacity=".38"';
  return `
  <g transform="rotate(-90 512 512)" fill="none" stroke-width="92">
    <circle cx="512" cy="512" r="262" stroke="${w}" stroke-dasharray="823 823" stroke-dashoffset="-274"/>
    <circle cx="512" cy="512" r="262" stroke="${accent}" stroke-dasharray="398 1248" stroke-dashoffset="-1134"/>
    <circle cx="512" cy="512" r="262" stroke="${w}" ${faded} stroke-dasharray="146 1500" stroke-dashoffset="-1569"/>
  </g>
  <g transform="translate(512 522) scale(0.84) translate(-495 -525)" fill="none" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
    <path d="M410 380 H580" stroke="${w}"/>
    <path d="M410 460 H580" stroke="${w}"/>
    <path d="M455 380 Q565 380 565 460 Q565 540 455 540 H415 L560 670" stroke="${w}"/>
    <path d="M580 380 L708 252" stroke="${accent}"/>
    <path d="M624 252 H708 V336" stroke="${accent}"/>
  </g>`;
}

/**
 * @param {object} o
 * @param {'square'|'rounded'|'none'} o.bg  square = full bleed (OS applies its own mask);
 *   rounded = squircle-ish tile with transparent corners; none = transparent.
 * @param {number} [o.scale]  glyph scale around the centre.
 * @param {boolean} [o.mono]  single-colour glyph (Android themed icon).
 */
function svg({ bg, scale = 1, mono = false }) {
  const bgRect =
    bg === 'none'
      ? ''
      : bg === 'rounded'
        ? `<rect width="1024" height="1024" rx="229" fill="url(#ftBg)"/><rect width="1024" height="1024" rx="229" fill="url(#ftGlow)"/>`
        : `<rect width="1024" height="1024" fill="url(#ftBg)"/><rect width="1024" height="1024" fill="url(#ftGlow)"/>`;
  const g = scale === 1 ? glyph({ mono }) : `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${glyph({ mono })}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${defs}${bgRect}${g}</svg>\n`;
}

function backgroundOnly() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${defs}<rect width="1024" height="1024" fill="url(#ftBg)"/><rect width="1024" height="1024" fill="url(#ftGlow)"/></svg>\n`;
}

/* ---------- Output table ---------- */

const m = (f) => path.join(ROOT, 'mobile', 'assets', 'images', f);
const w = (f) => path.join(ROOT, 'web', 'public', f);
const u = (f) => path.join(ROOT, 'ui-mocks', 'assets', 'img', f);

const rounded = svg({ bg: 'rounded' });
// Android adaptive: 108dp canvas, ~72dp visible, 66dp safe circle → glyph at 0.68.
const androidFg = svg({ bg: 'none', scale: 0.68 });
const androidMono = svg({ bg: 'none', scale: 0.68, mono: true });

const PNGS = [
  // Mobile (Expo)
  { out: m('icon.png'), size: 1024, svg: svg({ bg: 'square' }) },
  { out: m('android-icon-foreground.png'), size: 432, svg: androidFg },
  { out: m('android-icon-background.png'), size: 432, svg: backgroundOnly() },
  { out: m('android-icon-monochrome.png'), size: 432, svg: androidMono },
  { out: m('splash-icon.png'), size: 512, svg: rounded },
  { out: m('splash-icon-dark.png'), size: 512, svg: rounded },
  { out: m('brand-mark.png'), size: 512, svg: rounded },
  { out: m('brand-mark-dark.png'), size: 512, svg: rounded },
  { out: m('favicon.png'), size: 64, svg: rounded },
  // Web
  { out: w('apple-touch-icon.png'), size: 180, svg: svg({ bg: 'square' }) },
  { out: w('favicon-32.png'), size: 32, svg: rounded },
  { out: w('icon-192.png'), size: 192, svg: rounded },
  { out: w('icon-512.png'), size: 512, svg: rounded },
  // Maskable: glyph (≈61% wide) already sits inside the 80% safe circle.
  { out: w('icon-maskable-512.png'), size: 512, svg: svg({ bg: 'square' }) },
  // UI mocks
  { out: u('brand-mark.png'), size: 512, svg: rounded },
  { out: u('brand-mark-dark.png'), size: 512, svg: rounded },
];

const SVGS = [
  { out: path.join(__dirname, 'icon.svg'), svg: svg({ bg: 'square' }) },
  { out: path.join(__dirname, 'icon-rounded.svg'), svg: rounded },
  { out: w('favicon.svg'), svg: rounded },
];

const MANIFEST = {
  name: 'Finance Tracker',
  short_name: 'Finance',
  start_url: '/',
  display: 'standalone',
  background_color: '#F5F7F6',
  theme_color: '#0F766E',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

/* ---------- Render ---------- */

async function launch(chromium) {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      /* try next */
    }
  }
  throw new Error('No Chromium-based browser found (install Edge/Chrome or run `npx playwright install chromium`).');
}

(async () => {
  const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
  for (const f of [...PNGS, ...SVGS]) fs.mkdirSync(path.dirname(f.out), { recursive: true });

  for (const f of SVGS) fs.writeFileSync(f.out, f.svg);
  fs.writeFileSync(w('manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');

  const browser = await launch(chromium);
  const page = await browser.newPage();
  for (const f of PNGS) {
    await page.setViewportSize({ width: f.size, height: f.size });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${f.size}px;height:${f.size}px}</style></head><body>${f.svg}</body></html>`,
    );
    await page.screenshot({ path: f.out, omitBackground: true, clip: { x: 0, y: 0, width: f.size, height: f.size } });
    console.log('wrote', path.relative(ROOT, f.out));
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
