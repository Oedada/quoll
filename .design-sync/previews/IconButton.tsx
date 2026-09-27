import React from 'react';
import { IconButton } from '@atomaro/ui-kit';
import { Edit, Trash, Settings, More } from '@atomaro/icons';

const row = { display: 'flex', gap: 12, alignItems: 'center' };

export const Variants = () => (
  <div style={row}>
    <IconButton variant="primary" icon={<Edit />} aria-label="Редактировать" />
    <IconButton variant="secondary" icon={<Settings />} aria-label="Настройки" />
    <IconButton variant="outline" icon={<Trash />} aria-label="Удалить" />
    <IconButton variant="ghost" icon={<More />} aria-label="Ещё" />
  </div>
);

export const Neutral = () => (
  <div style={row}>
    <IconButton colorScheme="neutral" variant="primary" icon={<Edit />} />
    <IconButton colorScheme="neutral" variant="secondary" icon={<Settings />} />
    <IconButton colorScheme="neutral" variant="outline" icon={<Trash />} />
    <IconButton colorScheme="neutral" variant="ghost" icon={<More />} />
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <IconButton size="s" icon={<Edit />} />
    <IconButton size="m" icon={<Edit />} />
    <IconButton size="l" icon={<Edit />} />
    <IconButton size="xl" icon={<Edit />} />
  </div>
);

export const Disabled = () => <IconButton disabled icon={<Trash />} />;
