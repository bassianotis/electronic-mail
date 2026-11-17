/** Shared looks for the composer's rows (Explore 2, 2c): each at least 42px, a line underneath. */
import type React from 'react';

export const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    minHeight: '40px',
    padding: 'var(--space-1) 0',
    borderBottom: '1px solid var(--line-1)'
};

export const fieldLabel: React.CSSProperties = {
    flex: '0 0 60px',
    color: 'var(--text-3)',
    fontSize: 'var(--size-body)'
};
