import { Pencil } from 'lucide-react';

/** "Draft": the conversation holds a draft (bucket and Inbox cards), or the item is one (Up next). */
export const DraftBadge = () => (
    <span style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        backgroundColor: 'transparent',
        color: 'var(--action)',
        fontSize: 'var(--size-caption)',
        fontWeight: 'var(--weight-medium)',
        padding: '0',
        borderRadius: 'var(--radius-full)'
    }}>
        <Pencil size={14} style={{ display: 'none' }} />
        Draft
    </span>
);
