import React, { useState } from 'react';
import { TabsGroup, TabsItem, TabsPanel, Typography } from '@atomaro/ui-kit';
import { DocumentText, Users, Calendar } from '@atomaro/icons';

export const Default = () => {
  const [value, setValue] = useState('0');
  return (
    <div style={{ width: 520 }}>
      <TabsGroup value={value} onChange={setValue}>
        <TabsItem index="0" label="Общее" />
        <TabsItem index="1" label="Контакты" />
        <TabsItem index="2" label="Договоры" dot />
        <TabsItem index="3" label="История" />
      </TabsGroup>
      <TabsPanel value={value} index="0">
        <Typography variant="body-m">Карточка вуза: реквизиты, регион, ответственный менеджер.</Typography>
      </TabsPanel>
      <TabsPanel value={value} index="1">
        <Typography variant="body-m">Контактные лица вуза.</Typography>
      </TabsPanel>
      <TabsPanel value={value} index="2">
        <Typography variant="body-m">Договоры и продукты.</Typography>
      </TabsPanel>
      <TabsPanel value={value} index="3">
        <Typography variant="body-m">Журнал изменений.</Typography>
      </TabsPanel>
    </div>
  );
};

export const Small = () => (
  <div style={{ width: 520 }}>
    <TabsGroup size="s" value="1">
      <TabsItem size="s" index="0" label="Все" />
      <TabsItem size="s" index="1" label="В работе" />
      <TabsItem size="s" index="2" label="На паузе" />
      <TabsItem size="s" index="3" label="Закрытые" />
    </TabsGroup>
  </div>
);

export const WithIcons = () => (
  <div style={{ width: 520 }}>
    <TabsGroup value="0" iconPosition="left">
      <TabsItem index="0" label="Документы" icon={<DocumentText />} iconPosition="left" />
      <TabsItem index="1" label="Участники" icon={<Users />} iconPosition="left" />
      <TabsItem index="2" label="Встречи" icon={<Calendar />} iconPosition="left" />
    </TabsGroup>
  </div>
);

export const Disabled = () => (
  <div style={{ width: 520 }}>
    <TabsGroup value="0">
      <TabsItem index="0" label="Доступно" />
      <TabsItem index="1" label="Недоступно" disabled />
      <TabsItem index="2" label="Ещё вкладка" />
    </TabsGroup>
  </div>
);
