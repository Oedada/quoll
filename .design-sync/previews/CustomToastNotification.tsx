import React, { useEffect } from 'react';
import { ToastNotificationsProvider, useNotificationsStack, Typography, Button } from '@atomaro/ui-kit';

const Show = () => {
  const { addCustomNotification } = useNotificationsStack();
  useEffect(() => {
    addCustomNotification({
      id: 'c1',
      children: () => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
          <Typography variant="body-m">Экспорт реестра готов</Typography>
          <Button size="s" label="Скачать" />
        </div>
      ),
    });
  }, []);
  return null;
};

export const Default = () => (
  <ToastNotificationsProvider position="topRight" useInPortal={false}>
    <Show />
  </ToastNotificationsProvider>
);
