/**
 * "Images hidden · Load images": a row in the card's own chrome, between the sender row and the
 * body, never on the paper sheet, so a sender can't fake it. Shown only when the message has
 * outside images. Once they're loaded it stays, quieter, as "Images loaded", so images showing is
 * never a mystery (a screen reader hears it once, as it happens). The right side stays empty for
 * "Always for this sender".
 */
import React from 'react';
import { Image, ImageOff, Loader2 } from 'lucide-react';
import { useServerUnreachable } from '../../api/reachability';

export type ImagesState = 'hidden' | 'loading' | 'loaded';

export const ImagesStrip: React.FC<{
    state: ImagesState;
    onLoad: () => void;
    /** In the reading card (full width, the card's chrome) or inside an Inbox card (a rounded row above the body). */
    variant?: 'card' | 'inline';
}> = ({ state, onLoad, variant = 'card' }) => {
    // Loading images is one of the actions that wait while the server can't be reached
    const offline = useServerUnreachable();
    return (
        <div role="status" className={`images-strip images-strip-${variant}${state === 'loaded' ? ' images-strip-loaded' : ''}`}>
            {state === 'loaded' ? (
                <>
                    <Image size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>Images loaded</span>
                </>
            ) : state === 'loading' ? (
                <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    <span>Loading images…</span>
                </>
            ) : (
                <>
                    <ImageOff size={16} aria-hidden="true" style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
                    <span>Images hidden</span>
                    <span aria-hidden="true" style={{ color: 'var(--color-text-faint)' }}>·</span>
                    <button type="button" className="images-strip-load needs-server" disabled={offline} onClick={e => { e.stopPropagation(); onLoad(); }}>
                        Load images
                    </button>
                </>
            )}
        </div>
    );
};
