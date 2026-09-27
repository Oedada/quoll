import React, { useEffect, useRef } from 'react';
import { Tooltip, IconButton } from '@atomaro/ui-kit';
import { InformationStroke } from '@atomaro/icons';

const Opened = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('button')?.click(); }, []);
  return <div ref={ref} style={{ padding: '96px 140px 24px' }}>{children}</div>;
};

export const Default = () => (
  <Opened>
    <Tooltip trigger="click" placement="top" useInPortal={false} title="ИНН и КПП" subtitle="Вуз однозначно определяется парой ИНН + КПП">
      <IconButton variant="ghost" colorScheme="neutral" icon={<InformationStroke />} />
    </Tooltip>
  </Opened>
);

export const WithClose = () => (
  <Opened>
    <Tooltip trigger="click" placement="top" size="m" closeButton useInPortal={false} title="Подсказка" subtitle="Можно закрыть крестиком">
      <IconButton variant="ghost" colorScheme="neutral" icon={<InformationStroke />} />
    </Tooltip>
  </Opened>
);
