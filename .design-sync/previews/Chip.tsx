import React from 'react';
import { Chip } from '@atomaro/ui-kit';

const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const };

export const Primary = () => (
  <div style={row}>
    <Chip label="Все" counter={42} selected />
    <Chip label="Новые" counter={7} />
    <Chip label="В работе" counter={21} />
    <Chip label="Архив" disabled />
  </div>
);

export const Secondary = () => (
  <div style={row}>
    <Chip variant="secondary" label="Москва" selected />
    <Chip variant="secondary" label="Санкт-Петербург" />
    <Chip variant="secondary" label="Казань" />
  </div>
);
