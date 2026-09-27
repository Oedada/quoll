import React from 'react';
import { RadioButton, RadioGroup } from '@atomaro/ui-kit';

export const Primary = () => (
  <RadioGroup value="online">
    <RadioButton value="online" label="Онлайн" size="s" />
    <RadioButton value="offline" label="Очно" size="s" />
    <RadioButton value="mixed" label="Смешанный формат" size="s" disabled />
  </RadioGroup>
);

export const Secondary = () => (
  <RadioGroup value="b">
    <RadioButton variant="secondary" value="a" label="Бакалавриат" size="s" />
    <RadioButton variant="secondary" value="b" label="Магистратура" size="s" />
  </RadioGroup>
);

export const Sizes = () => (
  <RadioGroup value="s">
    <RadioButton value="s" label="Размер S" size="s" />
    <RadioButton value="xs" label="Размер XS" size="xs" />
  </RadioGroup>
);
