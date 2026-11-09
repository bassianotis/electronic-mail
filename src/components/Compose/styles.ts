/** Shared looks for the composer's rows (Explore 2, 2c): each at least 42px, a line underneath. */
import type React from 'react';

export const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
    minHeight: '40px',
    padding: '4px 0',
    borderBottom: '1px solid var(--color-border)'
};

export const fieldLabel: React.CSSProperties = {
    flex: '0 0 60px',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)'
};
