import React, { useState } from 'react';
import { SegmentedControl, Segment } from '@atomaro/ui-kit';

export const Default = () => {
  const [value, setValue] = useState('week');
  return (
    <SegmentedControl value={value} onChange={setValue}>
      <Segment index="day" label="День" />
      <Segment index="week" label="Неделя" />
      <Segment index="month" label="Месяц" />
    </SegmentedControl>
  );
};

export const Secondary = () => (
  <SegmentedControl variant="secondary" value="list">
    <Segment variant="secondary" index="list" label="Списком" />
    <Segment variant="secondary" index="board" label="Доской" />
  </SegmentedControl>
);

export const Sizes = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    {(['s', 'm', 'l'] as const).map((size) => (
      <SegmentedControl key={size} size={size} value="a">
        <Segment size={size} index="a" label={`Размер ${size.toUpperCase()}`} />
        <Segment size={size} index="b" label="Вариант" />
      </SegmentedControl>
    ))}
  </div>
);

export const DisabledAll = () => (
  <SegmentedControl value="a" disabledAll>
    <Segment index="a" label="Первый" />
    <Segment index="b" label="Второй" />
  </SegmentedControl>
);
