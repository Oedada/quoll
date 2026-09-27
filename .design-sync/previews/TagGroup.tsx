import React from 'react';
import { TagGroup } from '@atomaro/ui-kit';

const items = [
  { key: 1, value: 'Кибербезопасность' },
  { key: 2, value: 'Python' },
  { key: 3, value: 'Сети' },
  { key: 4, value: 'DevOps' },
];

export const Default = () => <TagGroup items={items} />;

export const Closable = () => <TagGroup items={items} closable />;

export const Secondary = () => <TagGroup variant="secondary" items={items} />;

export const Sizes = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <TagGroup size="xs" items={items.slice(0, 3)} />
    <TagGroup size="s" items={items.slice(0, 3)} />
    <TagGroup size="m" items={items.slice(0, 3)} />
  </div>
);

export const States = () => (
  <TagGroup items={items} disabledItems={[items[2]]} errorItems={[items[3]]} />
);
