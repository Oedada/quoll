import React from 'react';
import { Typography } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 8 };

export const Headings = () => (
  <div style={col}>
    <Typography variant="display-m">Display M</Typography>
    <Typography variant="heading-h1">Заголовок H1</Typography>
    <Typography variant="heading-h2">Заголовок H2</Typography>
    <Typography variant="heading-h3">Заголовок H3</Typography>
    <Typography variant="heading-h4">Заголовок H4</Typography>
    <Typography variant="heading-h5">Заголовок H5</Typography>
  </div>
);

export const Body = () => (
  <div style={{ ...col, maxWidth: 480 }}>
    <Typography variant="body-l">Body L — ИТ Школа Ростелекома помогает вузам запускать практико-ориентированные курсы.</Typography>
    <Typography variant="body-m">Body M — основной текст интерфейса: описания, значения полей, комментарии.</Typography>
    <Typography variant="body-s">Body S — вторичный текст и подписи в плотных таблицах.</Typography>
    <Typography variant="body-m" strong>Body M strong — акцент внутри текста.</Typography>
  </div>
);

export const Description = () => (
  <div style={col}>
    <Typography variant="description-l">Description L</Typography>
    <Typography variant="description-m">Description M</Typography>
    <Typography variant="description-s">Description S</Typography>
    <Typography variant="caption">Caption</Typography>
  </div>
);
