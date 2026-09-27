import React from 'react';
import { TabsGroup, TabsItem } from '@atomaro/ui-kit';
import { Users } from '@atomaro/icons';

export const States = () => (
  <div style={{ width: 520 }}>
    <TabsGroup value="0">
      <TabsItem index="0" label="Активная" />
      <TabsItem index="1" label="С точкой" dot />
      <TabsItem index="2" label="С иконкой" icon={<Users />} iconPosition="left" />
      <TabsItem index="3" label="Недоступна" disabled />
    </TabsGroup>
  </div>
);
