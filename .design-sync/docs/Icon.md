---
category: icons
---
# Icons (@atomaro/icons)

Icon set of the design system: 749 icons at 24px and 303 at 16px, each its own React component on `window.Atomaro`; in code import them from `'@atomaro/icons'`. `Icon` is the shared base they are built on - use it only to wrap a custom SVG path. **Full name list: `guidelines/icons-catalog.md`** - read it before picking an icon; never guess names.

```jsx
import { Search, Edit16 } from '@atomaro/icons';
import { Button, IconButton } from '@atomaro/ui-kit';

<Button label="Найти" iconPrefix={<Search />} />
<IconButton variant="ghost" icon={<Edit16 />} />
<Search fill="var(--accent-default)" size={32} />
```

Props (all icons): `fill` (color; without it the icon is painted #0E1117 - inside Button/IconButton the component recolors it, standalone pass `fill="var(--neutral-default)"` or similar), `size` (px, default 24; values <= 1 are a percentage), `className`, `style`. `secondaryColor` only affects NotificationNew, CartOn and MailInbox.

- 24px icons are the default for buttons, inputs and navigation; 16px icons (same name + `16`, e.g. `Edit16`) go in dense places: small buttons, table cells. Not every 24px icon has a 16px twin.
- These names contain Cyrillic letters (х, С) instead of Latin ones: EqualiserСlear, Speed1х, Speed2х, Speed4х, Speed6х, Speed8х, Сookie.
- Color variants follow `<Name>Color` / `<Name>Monochrome` / `<Name>Stroke` where they exist (InformationColor, InformationStroke).
- Categories: action (78), alert (25), business (44), communication (52), culture (28), document (67), editor (80), logo (54), media (71), navigation (52), place (78), rating (35), technology (85).

Common picks: AddLarge, AddSmall, Edit, Pencil, Trash, Copy, Download, Upload, Search, Filter, FilterClear, Settings, SettingsAdjust, Refresh, Print, Share, More, MenuKebab, Menu, Home, CloseLarge, CloseSmall, CheckLarge, CheckSmall, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, InformationStroke, Attention, Lock, User, Users, UserMan, UserWoman, Mail, Phone, Calendar, CalendarAdd, TimeStroke, DocumentText, DocumentAdd, DocumentEdit, Folder, Attachment, Education, Heart, Checklist, Edit16, Trash16, Copy16, Download16, Filter16, Home16, Lock16, Link16.
