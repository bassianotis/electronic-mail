import { Pencil } from 'lucide-react';

/** "Draft": the conversation holds a draft (bucket and Inbox cards), or the item is one (Up next). */
export const DraftBadge = () => (
    <span style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        backgroundColor: 'var(--draft-bg)',
        color: 'var(--draft-text)',
        fontSize: 'var(--font-size-2xs)',
        fontWeight: 'var(--weight-semibold)',
        padding: 'var(--draft-pad)',
        borderRadius: 'var(--radius-full)'
    }}>
        <Pencil size={14} style={{ display: 'var(--draft-icon)' }} />
        Draft
    </span>
);
