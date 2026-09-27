import React from 'react';
import { InputDate } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 16, width: 320 };

export const Default = () => (
  <div style={col}>
    <InputDate label="Дата встречи" placeholder="ДД.ММ.ГГГГ" useInPortal={false} />
  </div>
);

export const Filled = () => (
  <div style={col}>
    <InputDate label="Дата подписания" activeDate={new Date(2026, 8, 15)} useInPortal={false} />
  </div>
);

export const Range = () => (
  <div style={col}>
    <InputDate
      label="Период обучения"
      isRange
      activeDate={new Date(2026, 8, 1)}
      secondDate={new Date(2026, 11, 25)}
      useInPortal={false}
    />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <InputDate label="Дата" disabled useInPortal={false} />
  </div>
);
