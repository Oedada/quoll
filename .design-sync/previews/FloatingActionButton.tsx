import React, { useEffect, useRef } from 'react';
import { FloatingActionButton } from '@atomaro/ui-kit';
import { AddLarge, DocumentAdd, UserMan, CalendarAdd } from '@atomaro/icons';

export const Default = () => (
  <FloatingActionButton iconPrefix={<AddLarge />} label="Создать" useInPortal={false} />
);

export const WithMenu = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('button')?.click(); }, []);
  return (
    <div ref={ref} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', height: 320 }}>
      <FloatingActionButton
        iconPrefix={<AddLarge />}
        useInPortal={false}
        items={[
          { label: 'Взаимодействие', icon: <DocumentAdd /> },
          { label: 'Контакт', icon: <UserMan /> },
          { label: 'Встреча', icon: <CalendarAdd /> },
        ]}
      />
    </div>
  );
};

export const Secondary = () => (
  <FloatingActionButton variant="secondary" iconPrefix={<AddLarge />} label="Создать" useInPortal={false} />
);
