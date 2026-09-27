# Atomaro RTK — conventions for building with this library

Atomaro is the Rostelecom design system. This project ships **@atomaro/ui-kit 0.1.3** with an orange Rostelecom accent (#FF4F12) layered over the stock theme, plus the **@atomaro/icons** set. All components and icons are on `window.Atomaro`. In code, import components from `'@atomaro/ui-kit'` and icons from `'@atomaro/icons'`.

## Setup
- `styles.css` must be loaded before the first render. Components read CSS custom properties at mount (`getComputedStyle`), and DropdownMenu, Popover, Tooltip, InputDate and Breadcrumbs **throw** ("No css variable found for --…") without them. No provider or theme wrapper is needed; tokens live on `:root`.
- Toasts need a `ToastNotificationsProvider` near the root. Show them with `useNotificationsStack().addNotification({ colorScheme, title, subtitle, icon: true, actionButtons, timeout })`, and `addCustomNotification({ children: (onClose) => <…/> })` for custom content.
- Font: Manrope (400/600/800) ships in `fonts/`. Never set another font family.

## Styling idiom
Components are styled by **props, not classes**: `variant`, `size`, `colorScheme`. Common values:
- Button / IconButton: `variant` primary | secondary | outline | ghost; `colorScheme` accent | neutral; `size` s | m | l | xl.
- Badge `colorScheme`: info | success | warning | error | neutral | status-01…06. Inline and toast notifications take info | success | warning | error.
- Typography `variant`: display-s/m/l, heading-h1…h5, body-s/m/l, description-s/m/l, caption. Add `strong` for bold body text. Use Typography for all text instead of raw `<h1>`/`<p>` styling.

For your own layout glue, use the theme tokens through `var(--…)`. Never hard-code hex colors.
- Spacing: `--spacing-1x` (4px) `--spacing-2x` (8px) `--spacing-3x` (12px) `--spacing-4x` (16px) `--spacing-6x` (24px) `--spacing-8x` (32px) `--spacing-12x` (48px).
- Surfaces: `--bg-page`, `--bg-surface1`…`--bg-surface5`, `--bg-elevated-s/m/l`. Borders: `--border-default`, `--border-soft`, `--border-muted`.
- Radius: `--border-radius-s/m/l/xl`, `--border-radius-controls`, `--border-radius-full`. Shadows: `--shadow-bottom-s/m/l`.
- Colors: `--accent-default` / `--accent-hover` / `--accent-soft` / `--accent-container-default`, `--neutral-default` / `--neutral-soft` / `--neutral-muted`, and the same shape for `--success-*`, `--warning-*`, `--error-*`, `--info-*`. The raw palette is `--accent-50…900` and `--neutral-50…990`.
- Text shorthands: `font: var(--font-body-m)`, `var(--font-heading-h3)` and so on.

## Where the truth lives
- `styles.css` → `tokens/rtk-light.css` holds every token name. Read it before styling.
- `components/general/<Name>/<Name>.d.ts` is the exact prop API. It is version 0.1.3, so props from newer Atomaro docs may not exist here. There is **no** Box, Modal, Pagination, Table or Select export: build those from layout divs plus tokens.
- `components/general/<Name>/<Name>.prompt.md` holds usage examples.
- Icons: `components/icons/Icon/Icon.prompt.md` covers usage and props; `guidelines/icons-catalog.md` lists every icon name. Pick names from that list only; a few contain Cyrillic letters (`Speed2х`, `Сookie`).

## Gotchas
- Group components take their children directly: `RadioGroup` > `RadioButton`, `SegmentedControl` > `Segment index`, `TabsGroup value` > `TabsItem index` with sibling `TabsPanel value index`.
- `ChipGroup.items` need `contentItems` (a ReactElement[]); the chip counter is its length.
- RadioButton sizes are only `s` | `xs`.

## Example
```jsx
import { Typography, Input, Button, Badge } from '@atomaro/ui-kit';

<div style={{ background: 'var(--bg-surface1)', borderRadius: 'var(--border-radius-l)',
  boxShadow: 'var(--shadow-bottom-s)', padding: 'var(--spacing-6x)',
  display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4x)', width: 400 }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2x)' }}>
    <Typography variant="heading-h3">МТУСИ</Typography>
    <Badge colorScheme="success" label="Подписан" />
  </div>
  <Input label="Контактное лицо" defaultValue="Иванов Иван" />
  <div style={{ display: 'flex', gap: 'var(--spacing-2x)' }}>
    <Button label="Сохранить" />
    <Button variant="outline" label="Отмена" />
  </div>
</div>
```
