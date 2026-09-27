import React from 'react';
import { FunctionButton } from '@atomaro/ui-kit';
import { AddSmall, ArrowRight } from '@atomaro/icons';

const row = { display: 'flex', gap: 16, alignItems: 'center' };

export const Variants = () => (
  <div style={row}>
    <FunctionButton variant="primary" label="Добавить контакт" />
    <FunctionButton variant="secondary" label="Показать все" />
    <FunctionButton variant="tertiary" label="Сбросить фильтры" />
  </div>
);

export const WithIcon = () => (
  <div style={row}>
    <FunctionButton icon={<AddSmall />} iconPosition="left" label="Добавить" />
    <FunctionButton icon={<ArrowRight />} iconPosition="right" label="Перейти к договору" />
  </div>
);

export const Disabled = () => <FunctionButton disabled label="Недоступно" />;
