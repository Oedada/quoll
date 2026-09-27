import React from 'react';
import { Loader } from '@atomaro/ui-kit';

const row = { display: 'flex', gap: 24, alignItems: 'center' };

export const Sizes = () => (
  <div style={row}>
    <Loader size="m" />
    <Loader size="s" />
    <Loader size="2xs" />
  </div>
);

export const Secondary = () => (
  <div style={{ ...row, background: 'var(--neutral-900)', padding: 16, borderRadius: 8 }}>
    <Loader variant="secondary" size="m" />
    <Loader variant="secondary" size="s" />
  </div>
);
