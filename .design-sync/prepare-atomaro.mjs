// Prepares the public @atomaro/ui-kit 0.1.3 for design-sync (idempotent):
// 1. compiles the .scss its components require() into .css and repoints the
//    requires - the package expects the host bundler to handle scss;
// 2. recolors the light theme (blue #0055FF accent) to Rostelecom orange into
//    theme/rtk-light.css - a hand-picked stand-in until the real @atomaro/themes
//    package is reachable (KSPD only).
// usage: node .design-sync/prepare-atomaro.mjs <node_modules>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const nm = process.argv[2] && resolve(process.argv[2]);
if (!nm) throw new Error('usage: prepare-atomaro.mjs <node_modules>');
const pkg = join(nm, '@atomaro/ui-kit');
const sass = createRequire(join(nm, 'noop.js'))('sass');

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const files = walk(pkg);

let compiled = 0;
for (const f of files.filter((f) => f.endsWith('.scss') && !f.split('/').pop().startsWith('_'))) {
  if (f.includes('/styles/shared/')) continue;
  writeFileSync(f.replace(/\.scss$/, '.css'), sass.compile(f, { silenceDeprecations: ['import'] }).css);
  compiled++;
}
let repointed = 0;
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  const out = src.replace(/(require\(['"][^'"]+)\.scss(['"]\))/g, '$1.css$2');
  if (out !== src) { writeFileSync(f, out); repointed++; }
}
console.error(`scss: ${compiled} compiled, ${repointed} modules repointed`);

const dir = join(pkg, 'theme');
let css = readFileSync(join(dir, 'default-light.css'), 'utf8');

const BRAND = [255, 79, 18]; // #FF4F12
const HUE = 15;

const expand = (h) => (h.length === 3 ? [...h].map((c) => c + c).join('') : h).toLowerCase();
const rgb = (h) => [0, 2, 4].map((i) => parseInt(expand(h).slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  return [0, l > 0.5 ? d / (2 - max - min) : d / (max + min), l];
}
function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

// accent palette steps -> same lightness, orange hue; 500 pinned to the brand color
const map = new Map();
for (const [, step, hex] of css.matchAll(/--accent-(\d+):\s*#([0-9a-fA-F]{3,6});/g)) {
  const key = expand(hex);
  if (map.has(key) || key === '000000' || key === 'ffffff') continue;
  const [, s, l] = hsl(rgb(hex));
  map.set(key, step === '500' ? toHex(BRAND) : toHex(fromHsl(HUE, s, l)));
}

css = css.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, h) => map.get(expand(h)) ?? m);
css = css.replace(/rgba\(\s*0,\s*85,\s*255,/g, `rgba(${BRAND.join(', ')},`);

writeFileSync(join(dir, 'rtk-light.css'), css);
console.error(`rtk-light.css: ${map.size} accent colors remapped`);
