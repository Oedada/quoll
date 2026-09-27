// Builds the @atomaro/icons catalog for design-sync: icons-catalog.json (read by
// previews/Icon.tsx), docs/Icon.md (becomes Icon.prompt.md) and docs/icons-catalog.md
// (shipped to guidelines/ - the full list doesn't fit the prompt.md cap).
// usage: node .design-sync/gen-icons.mjs <node_modules>
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const nm = process.argv[2] && resolve(process.argv[2]);
if (!nm) throw new Error('usage: gen-icons.mjs <node_modules>');
const pkg = join(nm, '@atomaro/icons');
const here = dirname(fileURLToPath(import.meta.url));

const catalog = {};
for (const size of ['24', '16']) {
  catalog[size] = {};
  for (const cat of readdirSync(join(pkg, size)).sort()) {
    const dts = readFileSync(join(pkg, size, cat, 'index.d.ts'), 'utf8');
    catalog[size][cat] = [...dts.matchAll(/as (\S+?) \}/g)].map((m) => m[1]);
  }
}
writeFileSync(join(here, 'icons-catalog.json'), JSON.stringify(catalog) + '\n');

const count = (s) => Object.values(catalog[s]).flat().length;
// names that contain non-ASCII letters (e.g. Cyrillic "х" in Speed2х) are easy to mistype
const tricky = Object.values(catalog).flatMap((c) => Object.values(c).flat()).filter((n) => /[^\x00-\x7F]/.test(n));
const list24 = Object.entries(catalog['24']).map(([cat, names]) => `- **${cat}**: ${names.join(', ')}`).join('\n');

// common picks for a CRM, filtered to names that actually exist
const all = new Set(Object.values(catalog).flatMap((c) => Object.values(c).flat()));
const picks = ['AddLarge', 'AddSmall', 'Edit', 'Pencil', 'Trash', 'Copy', 'Download', 'Upload', 'Search', 'Filter', 'FilterClear',
  'Settings', 'SettingsAdjust', 'Refresh', 'Print', 'Share', 'More', 'MenuKebab', 'Menu', 'Home', 'CloseLarge', 'CloseSmall',
  'CheckLarge', 'CheckSmall', 'ChevronDown', 'ChevronUp', 'ChevronLeft', 'ChevronRight', 'ArrowLeft', 'ArrowRight',
  'InformationStroke', 'Attention', 'Lock', 'User', 'Users', 'UserMan', 'UserWoman', 'Mail', 'Phone', 'Calendar',
  'CalendarAdd', 'TimeStroke', 'DocumentText', 'DocumentAdd', 'DocumentEdit', 'Folder', 'Attachment', 'Education',
  'Heart', 'Checklist', 'Edit16', 'Trash16', 'Copy16', 'Download16', 'Filter16', 'Home16', 'Lock16', 'Link16']
  .filter((n) => all.has(n));

mkdirSync(join(here, 'docs'), { recursive: true });
writeFileSync(join(here, 'docs', 'icons-catalog.md'), `# @atomaro/icons - full catalog

${count('24')} icons at 24px, ${count('16')} at 16px. Import from \`'@atomaro/icons'\` (all are on \`window.Atomaro\`). Names are exact; ${tricky.join(', ')} contain Cyrillic letters.

## 24px by category
${list24}

## 16px by category
${Object.entries(catalog['16']).map(([cat, names]) => `- **${cat}**: ${names.join(', ')}`).join('\n')}
`);
writeFileSync(join(here, 'docs', 'Icon.md'), `---
category: icons
---
# Icons (@atomaro/icons)

Icon set of the design system: ${count('24')} icons at 24px and ${count('16')} at 16px, each its own React component on \`window.Atomaro\`; in code import them from \`'@atomaro/icons'\`. \`Icon\` is the shared base they are built on - use it only to wrap a custom SVG path. **Full name list: \`guidelines/icons-catalog.md\`** - read it before picking an icon; never guess names.

\`\`\`jsx
import { Search, Edit16 } from '@atomaro/icons';
import { Button, IconButton } from '@atomaro/ui-kit';

<Button label="Найти" iconPrefix={<Search />} />
<IconButton variant="ghost" icon={<Edit16 />} />
<Search fill="var(--accent-default)" size={32} />
\`\`\`

Props (all icons): \`fill\` (color; without it the icon is painted #0E1117 - inside Button/IconButton the component recolors it, standalone pass \`fill="var(--neutral-default)"\` or similar), \`size\` (px, default 24; values <= 1 are a percentage), \`className\`, \`style\`. \`secondaryColor\` only affects NotificationNew, CartOn and MailInbox.

- 24px icons are the default for buttons, inputs and navigation; 16px icons (same name + \`16\`, e.g. \`Edit16\`) go in dense places: small buttons, table cells. Not every 24px icon has a 16px twin.
- ${tricky.length ? `These names contain Cyrillic letters (х, С) instead of Latin ones: ${tricky.join(', ')}.` : ''}
- Color variants follow \`<Name>Color\` / \`<Name>Monochrome\` / \`<Name>Stroke\` where they exist (InformationColor, InformationStroke).
- Categories: ${Object.entries(catalog['24']).map(([c, n]) => `${c} (${n.length})`).join(', ')}.

Common picks: ${picks.join(', ')}.
`);
console.error(`icons: ${count('24')} x24, ${count('16')} x16, ${tricky.length} non-ASCII names`);
