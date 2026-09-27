import React from 'react';
import { TextArea } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 16, width: 360 };

export const Default = () => (
  <div style={col}>
    <TextArea label="Комментарий" placeholder="Опишите результат встречи" rows={4} />
  </div>
);

export const Filled = () => (
  <div style={col}>
    <TextArea
      label="Итоги встречи"
      defaultValue="Обсудили запуск курса по кибербезопасности на весенний семестр. Нужен договор до 15 октября."
      hint="Видно всем участникам взаимодействия"
      rows={4}
    />
  </div>
);

export const States = () => (
  <div style={col}>
    <TextArea label="Причина отказа" error="Поле обязательно" rows={3} />
    <TextArea label="Недоступно" defaultValue="Текст" disabled rows={2} />
  </div>
);
