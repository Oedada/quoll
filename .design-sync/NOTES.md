# design-sync notes: Atomaro (@atomaro/ui-kit) -> Claude Design «Atomaro RTK»

## Источник
- Актуальный Атомаро (ui-kit + core + themes + rtk-fonts) лежит в хранилище ПЦП `stock.digital.rt.ru` и в Фениксе, оба доступны только из КСПД. С домашней сети адрес резолвится в 10.242.x, соединение сбрасывается.
- Поэтому синхронизирован **@atomaro/ui-kit 0.1.3 с публичного npmjs** (февраль 2024, «Атомаро Про»): 33 компонента, тема синяя, шрифт Manrope. Сверх этого есть только @atomaro/icons 1.0.1.
- Для примеров использовался Storybook актуальной версии из MCP (rtk design). API сохранившихся компонентов в основном совпадает, но в 0.1.3 нет Box, Pagination, FileUpload, TableGrid, Tree, SideMenu, Modal/Drawer как экспортов и части пропсов (например, `Popover.title/body/footer`, `Breadcrumbs.colorScheme`, `DropdownMenu.onClickItem`). Сверять с `.d.ts` в `ds-bundle`, а не с MCP.

## Установка (не в корне репо)
- Пакет ставится в `.ds-sync/ds/` в обход корневого `.npmrc`, который направляет `@atomaro` в ПЦП:
  `cd .ds-sync/ds && npm i --@atomaro:registry=https://registry.npmjs.org @atomaro/ui-kit@0.1.3 @atomaro/icons@1.0.1 react@18 react-dom@18 styled-components@6 react-transition-group prop-types @types/react@18 sass @fontsource/manrope`
- Нужен `{"name":"ds-src","private":true}` в `.ds-sync/ds/package.json`. `--node-modules .ds-sync/ds/node_modules`.
- После установки: `node .design-sync/prepare-atomaro.mjs .ds-sync/ds/node_modules` (это `cfg.buildCmd`, идемпотентен).

## Подготовка пакета (prepare-atomaro.mjs)
- Компоненты 0.1.3 делают `require('.../x.scss')` и рассчитывают на бандлер потребителя. Скрипт компилирует scss в css (dart-sass) и переписывает require на `.css`. Без этого esbuild падает «No loader is configured for .scss».
- Тема: из `theme/default-light.css` генерируется `theme/rtk-light.css`, где синяя акцентная палитра (--accent-*, #0055FF и rgba(0,85,255,…)) перекрашена в оранжевый #FF4F12 с сохранением светлоты. **Цвета подобраны вручную, это не токены РТК.** Пользователь выбрал этот вариант осознанно.
- Токены в теме 0.1.3 задаются литералами, а не через var(), поэтому перекрашивание идёт заменой hex по всему файлу.

## Иконки
- Все экспорты @atomaro/icons попадают на `window.Atomaro` через `extraEntries`: 749 иконок 24px и 303 иконки 16px.
- Карточка «icons/Icon» заведена на базовый компонент `Icon` пакета. В индекс пакета он не экспортирован, поэтому его пробрасывает `.design-sync/icon-entry.mjs` через `extraEntries`, а `componentSrcMap` и `dtsPropsFor` добавляют его в список. Превью — галерея всех иконок из `icons-catalog.json`.
- `gen-icons.mjs` (часть buildCmd) генерирует `icons-catalog.json`, `docs/Icon.md` (идёт в `Icon.prompt.md` через docsMap) и `docs/icons-catalog.md` (идёт в `guidelines/` через guidelinesGlob). Полный список имён в `prompt.md` не влезает: там лимит около 8 КБ, конвертер обрезает.
- 7 имён содержат кириллицу: `Speed1х…8х`, `EqualiserСlear`, `Сookie`. Не «исправлять».
- Пути в `docsMap`, `extraEntries`, `guidelinesGlob` и `componentSrcMap` считаются от папки пакета (`.ds-sync/ds/node_modules/@atomaro/ui-kit`), отсюда `../../../../../`.

## Рантайм-грабли
- Компоненты читают CSS-переменные через getComputedStyle при монтировании (`utils/getValueFromCssVariable`) и **бросают исключение**, если переменная не найдена («No css variable found for --popover-m-pointer-offset»). Это касается DropdownMenu, Popover, Tooltip, InputDate, Breadcrumbs (через DropdownMenu). styles.css должен быть загружен до рендера.
- Тосты: `addNotification` замыкается на текущий стек, поэтому несколько вызовов в одном тике затирают друг друга. Добавлять по одному при обновлении контекста (см. previews/ToastNotification.tsx).
- `addCustomNotification` в 0.1.3 принимает `children: (onClose) => ReactNode`. Проп `content` из новых доков здесь не работает.
- Tooltip не имеет `isOpened`: в превью открывается программным кликом по триггеру (`trigger="click"`). У FAB меню открывается так же.

## Проверка
- Playwright/Chromium пользователь ставить не стал: визуальную проверку делает сам по `.review.html`. Validate идёт с `--no-render-check`.
- Вместо этого есть `node .design-sync/smoke.mjs ds-bundle`: jsdom-прогон карточек, ловит исключения и пустые ячейки (стили инлайнятся, иначе падает на CSS-переменных). Нужен `jsdom` в `.ds-sync` и симлинк `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`.

## Known render warns
- `[TOKENS_MISSING]` на 40 переменных (`--radiobutton-m-*`, `--input-primary-hint-color-focus`, `--checkbox-primary-icon-color-disabled` и др.): в теме 0.1.3 их нет, это баг пакета. RadioButton в превью только размеров s/xs.
- `[RENDER_SKIPPED]`: ожидаемо, см. «Проверка».

## Re-sync risks
- Как только появится доступ к КСПД: пересинхронизировать на актуальный @atomaro/ui-kit + @atomaro/themes (rostelecom-default-light) + @atomaro/rtk-fonts. Тогда prepare-atomaro.mjs (и перекраска, и, вероятно, scss) не нужен, превью надо сверить с новым API. Это фактически новый импорт.
- Оранжевая палитра угадана, при сравнении с настоящей темой РТК оттенки hover/active могут отличаться.
- Шрифт Manrope берётся из @fontsource/manrope (веса 400/600/800 — те, что встречаются в теме).
- Всё визуальное проверено только человеком. jsdom-смоук не видит вёрстку.
