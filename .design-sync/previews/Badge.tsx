import React from 'react';
import { Badge } from '@atomaro/ui-kit';

const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const };
const schemes = ['info', 'success', 'warning', 'error', 'neutral'] as const;
const labels = { info: 'Новое', success: 'Подписан', warning: 'На паузе', error: 'Отказ', neutral: 'Черновик' };

export const Primary = () => (
  <div style={row}>
    {schemes.map((s) => <Badge key={s} colorScheme={s} label={labels[s]} />)}
  </div>
);

export const Secondary = () => (
  <div style={row}>
    {schemes.map((s) => <Badge key={s} variant="secondary" colorScheme={s} label={labels[s]} />)}
  </div>
);

export const Statuses = () => (
  <div style={row}>
    {(['status-01', 'status-02', 'status-03', 'status-04', 'status-05', 'status-06'] as const).map((s, i) => (
      <Badge key={s} colorScheme={s} label={`Шаг ${i + 1}`} />
    ))}
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Badge size="s" colorScheme="info" label="Размер S" />
    <Badge size="2xs" colorScheme="info" label="Размер 2XS" />
  </div>
);
