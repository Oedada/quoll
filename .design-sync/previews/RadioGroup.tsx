import React, { useState } from 'react';
import { RadioButton, RadioGroup } from '@atomaro/ui-kit';

export const Default = () => {
  const [value, setValue] = useState('spring');
  return (
    <RadioGroup value={value} onChange={setValue}>
      <RadioButton value="autumn" label="Осенний семестр" size="s" />
      <RadioButton value="spring" label="Весенний семестр" size="s" />
      <RadioButton value="summer" label="Летняя школа" size="s" />
    </RadioGroup>
  );
};

export const DisabledAll = () => (
  <RadioGroup value="a" disabledAll>
    <RadioButton value="a" label="Первый вариант" size="s" />
    <RadioButton value="b" label="Второй вариант" size="s" />
  </RadioGroup>
);
