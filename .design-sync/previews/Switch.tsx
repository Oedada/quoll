import React from 'react';
import { Switch } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 12 };

export const States = () => (
  <div style={col}>
    <Switch label="Уведомления на почту" defaultChecked />
    <Switch label="Показывать архивные" />
    <Switch label="Недоступно" disabled />
    <Switch label="Недоступно, включено" disabled defaultChecked />
  </div>
);

export const Sizes = () => (
  <div style={col}>
    <Switch size="s" label="Размер S" defaultChecked />
    <Switch size="xs" label="Размер XS" defaultChecked />
  </div>
);

export const LabelLeft = () => <Switch labelPosition="left" label="Только мои" defaultChecked />;
