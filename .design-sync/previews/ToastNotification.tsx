import React, { useEffect, useRef } from 'react';
import { ToastNotificationsProvider, useNotificationsStack } from '@atomaro/ui-kit';

const toasts = [
  { colorScheme: 'success' as const, icon: true, title: 'Изменения сохранены', closeButton: true },
  {
    colorScheme: 'info' as const,
    icon: true,
    title: 'Новое взаимодействие',
    subtitle: 'Вам назначен МТУСИ',
    actionButtons: [{ label: 'Открыть', action: () => {} }],
  },
];

// addNotification closes over the current stack, so push one toast per context update
const Show = () => {
  const { addNotification } = useNotificationsStack();
  const shown = useRef(0);
  useEffect(() => {
    if (shown.current < toasts.length) addNotification(toasts[shown.current++]);
  }, [addNotification]);
  return null;
};

export const Default = () => (
  <ToastNotificationsProvider position="topRight" useInPortal={false}>
    <Show />
  </ToastNotificationsProvider>
);
