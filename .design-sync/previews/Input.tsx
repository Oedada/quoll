import React from 'react';
import { Input } from '@atomaro/ui-kit';
import { Search } from '@atomaro/icons';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 16, width: 320 };

export const Default = () => (
  <div style={col}>
    <Input label="ФИО контакта" placeholder="Иванов Иван Иванович" />
    <Input label="Email" defaultValue="i.ivanov@university.ru" hint="Рабочая почта" clearable />
  </div>
);

export const Sizes = () => (
  <div style={col}>
    <Input size="s" label="Размер S" defaultValue="Значение" />
    <Input size="m" label="Размер M" defaultValue="Значение" />
    <Input size="l" label="Размер L" defaultValue="Значение" />
  </div>
);

export const WithIcon = () => (
  <div style={col}>
    <Input iconPrefix={<Search />} placeholder="Поиск по вузам" hideLabel label="Поиск" />
  </div>
);

export const States = () => (
  <div style={col}>
    <Input label="ИНН" defaultValue="77071234" error="ИНН должен содержать 10 или 12 цифр" forceError />
    <Input label="КПП" defaultValue="770701001" disabled />
  </div>
);
