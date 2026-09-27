import React from 'react';
import { Popover, Button, Typography } from '@atomaro/ui-kit';

export const Default = () => (
  <div style={{ padding: '24px 24px 200px' }}>
    <Popover
      isOpened
      placement="bottomLeft"
      useInPortal={false}
      innerChildren={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 260 }}>
          <Typography variant="heading-h5">Передать взаимодействие</Typography>
          <Typography variant="body-s">Новый менеджер получит уведомление и сможет принять или отклонить.</Typography>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="s" label="Передать" />
            <Button size="s" variant="outline" label="Отмена" />
          </div>
        </div>
      }
    >
      <Button variant="outline" label="Передать" />
    </Popover>
  </div>
);
