import React from 'react';
import { PickerDate } from '@atomaro/ui-kit';

export const Default = () => <PickerDate activeDate={new Date(2026, 8, 15)} />;

export const Range = () => (
  <PickerDate isRange activeDate={new Date(2026, 8, 8)} secondDate={new Date(2026, 8, 19)} />
);

export const WithTime = () => <PickerDate showTime activeDate={new Date(2026, 8, 15, 14, 30)} />;
