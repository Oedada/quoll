import React from 'react';
import { Breadcrumbs } from '@atomaro/ui-kit';

export const Default = () => (
  <Breadcrumbs>
    <a href="#">Главная</a>
    <a href="#">Вузы</a>
    <a href="#">МТУСИ</a>
  </Breadcrumbs>
);

export const Collapsed = () => (
  <Breadcrumbs useInPortal={false}>
    <a href="#">Главная</a>
    <a href="#">Регионы</a>
    <a href="#">Москва</a>
    <a href="#">Вузы</a>
    <a href="#">МТУСИ</a>
    <a href="#">Взаимодействие №128</a>
  </Breadcrumbs>
);
