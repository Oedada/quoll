import React from 'react';
import { ToastNotificationsProvider, useNotificationsStack, Button } from '@atomaro/ui-kit';

const Trigger = () => {
  const { addNotification } = useNotificationsStack();
  return (
    <Button
      label="Показать уведомление"
      onClick={() => addNotification({ id: String(Date.now()), colorScheme: 'success', icon: true, title: 'Сохранено', timeout: 4000 })}
    />
  );
};

export const Default = () => (
  <ToastNotificationsProvider position="topRight" useInPortal={false} maxCount={3}>
    <Trigger />
  </ToastNotificationsProvider>
);
