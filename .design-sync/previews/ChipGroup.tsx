import React from 'react';
import { ChipGroup } from '@atomaro/ui-kit';

const items = [
  { key: 'new', label: 'Новые', contentItems: [<span key="1" />, <span key="2" />, <span key="3" />] },
  { key: 'work', label: 'В работе', contentItems: [<span key="1" />, <span key="2" />, <span key="3" />, <span key="4" />, <span key="5" />] },
  { key: 'pause', label: 'На паузе', contentItems: [<span key="1" />] },
  { key: 'done', label: 'Закрыты', contentItems: [<span key="1" />, <span key="2" />] },
];

export const Default = () => <ChipGroup items={items} defaultSelectedItems={['work']} />;

export const WithTotal = () => <ChipGroup items={items} chipTotal chipTotalLabel="Все" />;

export const Secondary = () => (
  <ChipGroup variant="secondary" items={items} defaultSelectedItems={['new']} disabledItems={['done']} />
);
