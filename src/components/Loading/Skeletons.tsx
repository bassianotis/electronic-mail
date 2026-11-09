/**
 * Loading (Explore 1, board X1Loading). A skeleton shows only when something has had nothing to
 * show for 250ms, so a fast answer never flashes one. Each is drawn inside the real component's
 * own frame at its usual size, so nothing jumps when the content lands. The shapes are hidden from
 * screen readers; the region that is loading says it is busy. A failure replaces only the part
 * that failed, with a way to try again.
 */
import React from 'react';
import { useAfter } from '../../hooks/useAfter';

/** Renders its children only after the skeleton delay. */
export const AfterDelay: React.FC<{ children: React.ReactNode }> = ({ children }) => (useAfter() ? <>{children}</> : null);

/** One shape: a bar (or a block, with a radius) in --color-border, pulsing. */
export const Bone: React.FC<{ w: number | string; h: number; r?: string; style?: React.CSSProperties }> = ({ w, h, r, style }) => (
    <span aria-hidden="true" className="skeleton-bone" style={{ width: w, height: h, flexShrink: 0, ...(r ? { borderRadius: r } : {}), ...style }} />
);

const card: React.CSSProperties = {
    backgroundColor: 'var(--surface-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
};

/** 1. An Inbox card (InboxItem, closed). */
export const InboxCardSkeleton = () => (
    <div style={{ ...card, height: 156, padding: 'var(--space-lg)', marginBottom: 'var(--space-md)', boxShadow: 'var(--shadow-sm)', gap: '8px' }}>
        <Bone w="55%" h={18} style={{ marginTop: 4 }} />
        <Bone w="28%" h={12} style={{ marginTop: 4 }} />
        <Bone w="94%" h={12} style={{ marginTop: 8 }} />
        <Bone w="70%" h={12} />
    </div>
);

/** 2. An Up next card (236 x 118). */
export const UpNextCardSkeleton = () => (
    <div style={{ ...card, flex: '0 0 236px', height: 120, padding: '12px 16px', gap: '8px', boxShadow: 'var(--shadow-sm)' }}>
        <Bone w={48} h={14} />
        <Bone w="88%" h={12} style={{ marginTop: 4 }} />
        <Bone w="60%" h={12} />
        <Bone w="70%" h={10} style={{ marginTop: 'auto' }} />
    </div>
);

/** 3. A bucket card (EmailCard). */
export const BucketCardSkeleton = () => (
    <div style={{ ...card, height: 172, padding: 'var(--space-lg)', gap: '12px' }}>
        <Bone w="40%" h={12} />
        <Bone w="75%" h={18} />
        <Bone w="95%" h={12} style={{ marginTop: 4 }} />
        <Bone w="85%" h={12} />
        <Bone w="55%" h={12} />
    </div>
);

/** 4. An Archive row (ArchiveItem). */
export const ArchiveRowSkeleton = () => (
    <div style={{ ...card, height: 108, padding: 'var(--space-lg)', flexDirection: 'row', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            <Bone w="25%" h={14} style={{ marginTop: 4 }} />
            <Bone w="55%" h={14} />
        </span>
        <Bone w={90} h={10} style={{ marginTop: 4 }} />
    </div>
);

/** 5. A search result. */
export const SearchResultSkeleton = () => (
    <div style={{ ...card, height: 120, padding: 'var(--card-pad)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            <Bone w="50%" h={14} />
            <Bone w="22%" h={12} />
            <Bone w="14%" h={10} />
        </span>
        <Bone w={48} h={12} />
    </div>
);

/** 6. A message body. */
export const BodySkeleton: React.FC<{ minHeight: number }> = ({ minHeight }) => (
    <div aria-busy="true" style={{ minHeight, display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '4px' }}>
        <AfterDelay>
            {[92, 88, 96, 70, 0, 85, 90, 64].map((w, i) => (w ? <Bone key={i} w={`${w}%`} h={12} /> : <span key={i} style={{ height: 8 }} />))}
        </AfterDelay>
    </div>
);

/** The secondary button the failures offer. */
const TryAgain: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={e => { e.stopPropagation(); onClick(); }}
        style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-main)',
            padding: '4px 16px',
        }}
    >
        Try again
    </button>
);

/** A message body that failed: only that part is replaced. */
export const BodyFailure: React.FC<{ onRetry: () => void; minHeight: number }> = ({ onRetry, minHeight }) => (
    <div role="alert" style={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', paddingTop: '4px' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Couldn't load this message. The rest of the conversation is still here.
        </p>
        <TryAgain onClick={onRetry} />
    </div>
);

/** A page of a list that failed to load: what's already loaded stays. */
export const ListFailure: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: 'var(--space-lg)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Couldn't load more.</span>
        <TryAgain onClick={onRetry} />
    </div>
);
