import React from 'react';
import { CheckboxGroup } from '@atomaro/ui-kit';

const options = [
  { key: 'ib', value: 'Информационная безопасность' },
  { key: 'ds', value: 'Анализ данных' },
  { key: 'dev', value: 'Разработка ПО' },
  { key: 'net', value: 'Сети и телеком' },
];

export const Default = () => (
  <CheckboxGroup title="Направления" options={options} defaultChecked={['ib', 'ds']} />
);

export const WithParent = () => (
  <CheckboxGroup title="Все направления" parentBox options={options} defaultChecked={['dev']} />
);

export const Disabled = () => (
  <CheckboxGroup title="Направления" options={options} disabledItems={['net']} defaultChecked={['ib']} />
);
