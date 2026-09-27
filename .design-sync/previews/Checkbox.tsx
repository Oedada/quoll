import React from 'react';
import { Checkbox } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 12 };

export const States = () => (
  <div style={col}>
    <Checkbox label="Согласие на обработку данных" />
    <Checkbox label="Договор подписан" defaultChecked />
    <Checkbox label="Выбраны не все" indeterminate />
    <Checkbox label="Недоступно" disabled />
    <Checkbox label="Недоступно, выбрано" disabled defaultChecked />
  </div>
);

export const Sizes = () => (
  <div style={col}>
    <Checkbox size="s" label="Размер S" defaultChecked />
    <Checkbox size="xs" label="Размер XS" defaultChecked />
  </div>
);
