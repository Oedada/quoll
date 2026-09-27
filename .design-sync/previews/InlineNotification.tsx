import React from 'react';
import { InlineNotification } from '@atomaro/ui-kit';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 12, width: 480 };

export const ColorSchemes = () => (
  <div style={col}>
    <InlineNotification colorScheme="info" icon title="Взаимодействие передано" subtitle="Ожидает подтверждения нового менеджера" />
    <InlineNotification colorScheme="success" icon title="Договор подписан" />
    <InlineNotification colorScheme="warning" icon title="Срок шага истекает завтра" />
    <InlineNotification colorScheme="error" icon title="Не удалось сохранить" subtitle="Проверьте ИНН и КПП" />
  </div>
);

export const WithActions = () => (
  <div style={col}>
    <InlineNotification
      colorScheme="info"
      icon
      closeButton
      title="Вам передано взаимодействие"
      subtitle="МТУСИ, шаг 3 «Переговоры»"
      actionButtons={[
        { label: 'Принять', action: () => {} },
        { label: 'Отклонить', action: () => {} },
      ]}
    />
  </div>
);
