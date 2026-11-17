/**
 * The corner window (Explore 2, section 4): the draft popped out of its conversation (or out of the
 * centred new-message layer), bottom right, so everything else works as usual while writing.
 * 460×560 with the composer's own fields, message and footer; minimised, a 340×46 bar. It sits at
 * layer 350: above the conversation (200/300), Search (300) and Settings (201), below the notices
 * (400) so "Sending… Undo" and "Draft saved · Open" are never hidden. Rendered at the app level,
 * so clicks on it never reach a conversation's backdrop, and keys pressed in it never reach the
 * conversation's own keys.
 */
import React, { useRef } from 'react';
import { ChevronUp, Maximize2, Minus, X } from 'lucide-react';
import { useComposer } from '../../context/ComposerContext';
import { composerTitle } from '../../utils/replyDraft';
import { Composer } from './Composer';
import { useEscape, Z } from '../../utils/layers';
import { IconButton } from '../../ui/Button';

const LAYER = Z.panel.corner;

export const CornerWindow: React.FC = () => {
    const { draft, update, dock, close } = useComposer();
    // Esc in it closes it, keeping the draft (rule L4), as in the docked composer. It isn't modal, so
    // only while the focus is in it; every other key stays in it.
    const windowRef = useRef<HTMLElement>(null);
    useEscape(draft?.place === 'corner', 'panel', () => void close(), { within: windowRef });
    if (!draft || (draft.place !== 'corner' && draft.place !== 'minimised')) return null;

    const title = composerTitle(draft);
    // The window's buttons, named in words for screen readers and their tooltips (board P4, change 2).
    // Make larger goes back into the thread, or to the centred new message.
    const back = <IconButton label="Make larger" icon={<Maximize2 size={16} aria-hidden="true" />} onClick={dock} />;
    // Close keeps the draft: saved (it stays in Up next), or kept on this computer if it can't be
    const closeButton = <IconButton label="Close" keys="Esc" icon={<X size={16} aria-hidden="true" />} onClick={() => void close()} />;

    if (draft.place === 'minimised') {
        return (
            <div
                data-layer="panel"
                onKeyDown={e => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    right: '24px',
                    bottom: 0,
                    zIndex: LAYER,
                    width: 'min(340px, calc(100vw - 48px))',
                    height: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    padding: '0 var(--space-2) 0 var(--space-4)',
                    boxSizing: 'border-box',
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--line-2)',
                    borderBottom: 0,
                    borderRadius: 'var(--radius-3) var(--radius-3) 0 0',
                    boxShadow: 'var(--shadow-raised)'
                }}
            >
                <button type="button" onClick={() => update({ place: 'corner' }, false)} style={{
                    all: 'unset',
                    flex: 1,
                    minWidth: 0,
                    cursor: 'pointer',
                    fontSize: 'var(--size-body)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-1)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </button>
                <IconButton label="Open" icon={<ChevronUp size={16} aria-hidden="true" />} onClick={() => update({ place: 'corner' }, false)} />
                {back}
                {closeButton}
            </div>
        );
    }

    return (
        <section
            ref={windowRef}
            aria-label="Draft in the corner"
            data-layer="panel"
            onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation(); }}
            style={{
                position: 'fixed',
                right: '24px',
                bottom: 0,
                zIndex: LAYER,
                width: 'min(460px, calc(100vw - 48px))', // 24px clear of each side in a narrow window
                height: '560px',
                maxHeight: 'calc(100vh - 24px)',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--surface-raised)',
                border: '1px solid var(--line-2)',
                borderBottom: 0,
                borderRadius: 'var(--radius-3) var(--radius-3) 0 0',
                boxShadow: 'var(--shadow-raised)',
                overflow: 'hidden'
            }}
        >
            <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', height: '48px', padding: '0 var(--space-2) 0 var(--space-4)', background: 'var(--surface-raised)', borderBottom: '1px solid var(--line-1)', flexShrink: 0 }}>
                <h2 style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'var(--size-body)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-1)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </h2>
                <IconButton label="Minimize" icon={<Minus size={16} aria-hidden="true" />} onClick={() => update({ place: 'minimised' }, false)} />
                {back}
                {closeButton}
            </header>
            <div style={{ flex: 1, minHeight: 0 }}>
                <Composer place="corner" />
            </div>
        </section>
    );
};
