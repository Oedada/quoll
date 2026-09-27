import React from 'react';
import { Button } from '@atomaro/ui-kit';
import { AddLarge, Download, ArrowRight } from '@atomaro/icons';

const row = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary" label="Сохранить" />
    <Button variant="secondary" label="Черновик" />
    <Button variant="outline" label="Отмена" />
    <Button variant="ghost" label="Подробнее" />
  </div>
);

export const Neutral = () => (
  <div style={row}>
    <Button colorScheme="neutral" variant="primary" label="Сохранить" />
    <Button colorScheme="neutral" variant="secondary" label="Черновик" />
    <Button colorScheme="neutral" variant="outline" label="Отмена" />
    <Button colorScheme="neutral" variant="ghost" label="Подробнее" />
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button size="s" label="Размер S" />
    <Button size="m" label="Размер M" />
    <Button size="l" label="Размер L" />
    <Button size="xl" label="Размер XL" />
  </div>
);

export const WithIcons = () => (
  <div style={row}>
    <Button iconPrefix={<AddLarge />} label="Новое взаимодействие" />
    <Button variant="outline" iconPrefix={<Download />} label="Выгрузить" />
    <Button variant="ghost" iconSuffix={<ArrowRight />} label="Далее" />
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button disabled label="Сохранить" />
    <Button disabled variant="outline" label="Отмена" />
  </div>
);
