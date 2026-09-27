// usage: node .design-sync/smoke.mjs ds-bundle [Name,Name] (needs jsdom in .ds-sync + the .design-sync/node_modules symlink)
// jsdom runtime smoke for preview cards: no visuals, just crashes and empty cells
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const out = resolve(process.argv[2]);
const only = process.argv[3]?.split(',');
const cards = readdirSync(join(out, 'components'), { recursive: true }).filter((f) => f.endsWith('.html'));
const res = [];
for (const rel of cards) {
  const name = rel.split('/').pop().replace('.html', '');
  if (only && !only.includes(name)) continue;
  const file = join(out, 'components', rel);
  let html = readFileSync(file, 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
    `<script>${readFileSync(resolve(dirname(file), src), 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`);
  const flat = (f) => readFileSync(f, 'utf8').replace(/@import\s+(?:url\()?["']([^"')]+)["']\)?[^;]*;/g,
    (m, u) => /^https?:/.test(u) ? '' : flat(resolve(dirname(f), u)));
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>${flat(resolve(dirname(file), href))}</style>`);
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(String(e.message || e).split('\n')[0]));
  vc.on('error', (...a) => { const s = a.map(String).join(' '); if (!/Warning:|prop type|propType/i.test(s)) errs.push(s.split('\n')[0]); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/' });
  await new Promise((r) => setTimeout(r, 700));
  const cells = [...dom.window.document.querySelectorAll('.ds-cell, .ds-single')];
  const texts = cells.map((c) => (c.textContent || '').trim().slice(0, 60));
  const empty = cells.filter((c) => c.querySelectorAll('*').length < 3).length;
  res.push({ name, cells: cells.length, empty, errs: [...new Set(errs)].slice(0, 3) });
  dom.window.close();
}
for (const r of res) {
  const bad = r.errs.length || r.empty || !r.cells;
  console.log(`${bad ? '✗' : '✓'} ${r.name.padEnd(28)} cells=${r.cells} empty=${r.empty}${r.errs.length ? '\n    ' + r.errs.join('\n    ') : ''}`);
}
