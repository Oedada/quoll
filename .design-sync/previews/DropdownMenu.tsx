import React from 'react';
import { DropdownMenu, Button } from '@atomaro/ui-kit';
import { ChevronDown } from '@atomaro/icons';

const items = [
  { key: 'title', value: 'Статус', isTitle: true },
  { key: 'new', value: 'Новое' },
  { key: 'work', value: 'В работе', hint: '21 взаимодействие' },
  { key: 'pause', value: 'На паузе' },
  { key: 'div', value: '', isDivider: true },
  { key: 'closed', value: 'Закрыто' },
];

export const Default = () => (
  <div style={{ height: 320 }}>
    <DropdownMenu isOpened items={items} defaultValue={['work']} useInPortal={false} placement="bottomLeft">
      <Button variant="outline" label="Статус" iconSuffix={<ChevronDown />} />
    </DropdownMenu>
  </div>
);

export const Multiselect = () => (
  <div style={{ height: 280 }}>
    <DropdownMenu
      isOpened
      isMultiselect
      items={[
        { key: 'ib', value: 'Информационная безопасность' },
        { key: 'ds', value: 'Анализ данных' },
        { key: 'dev', value: 'Разработка ПО' },
        { key: 'net', value: 'Сети и телеком' },
      ]}
      defaultValue={['ib', 'dev']}
      disabledItems={['net']}
      useInPortal={false}
      placement="bottomLeft"
    >
      <Button variant="outline" label="Направления" iconSuffix={<ChevronDown />} />
    </DropdownMenu>
  </div>
);
