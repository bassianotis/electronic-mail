/**
 * The corner window (Explore 2, section 4): the draft popped out of its conversation (or out of the
 * centred new-message layer), bottom right, so everything else works as usual while writing.
 * 460×560 with the composer's own fields, message and footer; minimised, a 340×46 bar. It sits at
 * layer 350: above the conversation (200/300), Search (300) and Settings (201), below the notices
 * (400) so "Sending… Undo" and "Draft saved · Open" are never hidden. Rendered at the app level,
 * so clicks on it never reach a conversation's backdrop, and keys pressed in it never reach the
 * conversation's own keys.
 */
import React from 'react';
import { ChevronUp, Maximize2, Minus, X } from 'lucide-react';
import { useComposer } from '../../context/ComposerContext';
import { composerTitle } from '../../utils/replyDraft';
import { Composer } from './Composer';

const LAYER = 350;

const iconButton: React.CSSProperties = {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    borderRadius: 'var(--radius-full)',
    border: 0,
    background: 'transparent',
    color: 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
};

export const CornerWindow: React.FC = () => {
    const { draft, update, dock, close } = useComposer();
    if (!draft || (draft.place !== 'corner' && draft.place !== 'minimised')) return null;

    const title = composerTitle(draft);
    const backTitle = draft.original?.threadId ? 'Back into the thread' : 'Back to full size';
    const back = (
        <button type="button" title={backTitle} aria-label={backTitle} onClick={dock} className="em-icon-button" style={iconButton}>
            <Maximize2 size={16} aria-hidden="true" />
        </button>
    );
    const closeButton = (
        <button type="button" title="Close (the draft is saved)" aria-label="Close" onClick={() => void close()} className="em-icon-button" style={iconButton}>
            <X size={16} aria-hidden="true" />
        </button>
    );

    if (draft.place === 'minimised') {
        return (
            <div
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
                    gap: '4px',
                    padding: '0 8px 0 16px',
                    boxSizing: 'border-box',
                    background: 'var(--surface-header)',
                    border: '1px solid var(--border-strong)',
                    borderBottom: 0,
                    borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                    boxShadow: 'var(--shadow-corner)'
                }}
            >
                <button type="button" onClick={() => update({ place: 'corner' }, false)} style={{
                    all: 'unset',
                    flex: 1,
                    minWidth: 0,
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </button>
                <button type="button" title="Open" aria-label="Open" onClick={() => update({ place: 'corner' }, false)} className="em-icon-button" style={iconButton}>
                    <ChevronUp size={16} aria-hidden="true" />
                </button>
                {back}
                {closeButton}
            </div>
        );
    }

    return (
        <section
            aria-label="Draft in the corner"
            onKeyDown={e => e.stopPropagation()}
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
                border: '1px solid var(--border-strong)',
                borderBottom: 0,
                borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
                boxShadow: 'var(--shadow-corner-lifted)',
                overflow: 'hidden'
            }}
        >
            <header style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '48px', padding: '0 8px 0 16px', background: 'var(--surface-header)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
                <h2 style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </h2>
                <button type="button" title="Minimise" aria-label="Minimise" onClick={() => update({ place: 'minimised' }, false)} className="em-icon-button" style={iconButton}>
                    <Minus size={16} aria-hidden="true" />
                </button>
                {back}
                {closeButton}
            </header>
            <div style={{ flex: 1, minHeight: 0 }}>
                <Composer place="corner" />
            </div>
        </section>
    );
};
