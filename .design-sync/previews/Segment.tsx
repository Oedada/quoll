import React from 'react';
import { SegmentedControl, Segment } from '@atomaro/ui-kit';

export const States = () => (
  <SegmentedControl value="active">
    <Segment index="active" label="Выбран" />
    <Segment index="idle" label="Обычный" />
    <Segment index="off" label="Недоступен" disabled />
  </SegmentedControl>
);
