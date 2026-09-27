import React from 'react';
import { CustomInlineNotification, Typography, Button } from '@atomaro/ui-kit';

export const Default = () => (
  <div style={{ width: 480 }}>
    <CustomInlineNotification isOpened>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 16 }}>
        <Typography variant="body-m">Есть 3 незаполненных поля в карточке вуза</Typography>
        <Button size="s" variant="outline" label="Заполнить" />
      </div>
    </CustomInlineNotification>
  </div>
);
