import React from 'react';
import { TabsGroup, TabsItem, TabsPanel, Typography } from '@atomaro/ui-kit';

export const Default = () => (
  <div style={{ width: 520 }}>
    <TabsGroup value="1">
      <TabsItem index="0" label="Реквизиты" />
      <TabsItem index="1" label="Комментарии" />
    </TabsGroup>
    <TabsPanel value="1" index="0">
      <Typography variant="body-m">ИНН, КПП, адрес.</Typography>
    </TabsPanel>
    <TabsPanel value="1" index="1">
      <div style={{ paddingTop: 16 }}>
        <Typography variant="body-m">Показана только панель, чей index совпадает с value.</Typography>
      </div>
    </TabsPanel>
  </div>
);
