import React from 'react';
import * as Icons from '@atomaro/icons';
import catalog from '../icons-catalog.json';

const Gallery = ({ size }: { size: '24' | '16' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    {Object.entries(catalog[size] as Record<string, string[]>).map(([cat, names]) => (
      <section key={cat}>
        <div style={{ font: 'var(--font-heading-h5)', color: 'var(--neutral-default)', margin: '0 0 8px', textTransform: 'capitalize' }}>
          {cat} · {names.length}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 4 }}>
          {names.map((name) => {
            const C = (Icons as Record<string, React.ComponentType<{ fill?: string }>>)[name];
            return (
              <div key={name} title={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 4px', borderRadius: 'var(--border-radius-s)', background: 'var(--bg-surface2)' }}>
                {C ? <C fill="var(--neutral-default)" /> : null}
                <span style={{ font: 'var(--font-description-s)', color: 'var(--neutral-soft)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              </div>
            );
          })}
        </div>
      </section>
    ))}
  </div>
);

export const Size24 = () => <Gallery size="24" />;
export const Size16 = () => <Gallery size="16" />;

export const Colors = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <Icons.Search fill="var(--neutral-default)" />
    <Icons.Search fill="var(--accent-default)" />
    <Icons.Search fill="var(--success-default)" />
    <Icons.Search fill="var(--error-default)" />
    <Icons.Search fill="var(--accent-default)" size={40} />
  </div>
);
