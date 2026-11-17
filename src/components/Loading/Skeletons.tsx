/**
 * Loading (Explore 1, board X1Loading). A skeleton shows only when something has had nothing to
 * show for 300ms, so a fast answer never flashes one, and it stays still (no pulse, no shimmer). Each is drawn inside the real component's
 * own frame at its usual size, so nothing jumps when the content lands. The shapes are hidden from
 * screen readers; the region that is loading says it is busy. A failure replaces only the part
 * that failed, with a way to try again.
 */
import React from 'react';
import { useAfter } from '../../hooks/useAfter';
import { Button } from '../../ui/Button';

/** Renders its children only after the skeleton delay. */
export const AfterDelay: React.FC<{ children: React.ReactNode }> = ({ children }) => (useAfter() ? <>{children}</> : null);

/** One shape: a bar (or a block, with a radius) in --line-1, still. */
export const Bone: React.FC<{ w: number | string; h: number; r?: string; style?: React.CSSProperties }> = ({ w, h, r, style }) => (
    <span aria-hidden="true" className="skeleton-bone" style={{ width: w, height: h, flexShrink: 0, ...(r ? { borderRadius: r } : {}), ...style }} />
);

const card: React.CSSProperties = {
    backgroundColor: 'var(--surface-1)',
    border: '1px solid var(--line-1)',
    borderRadius: 'var(--radius-3)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
};

/** 1. An Inbox card (InboxItem, closed). */
export const InboxCardSkeleton = () => (
    <div style={{ ...card, height: 156, padding: 'var(--space-6)', marginBottom: 'var(--space-4)', boxShadow: 'none', gap: 'var(--space-2)' }}>
        <Bone w="55%" h={18} style={{ marginTop: 'var(--space-1)' }} />
        <Bone w="28%" h={12} style={{ marginTop: 'var(--space-1)' }} />
        <Bone w="94%" h={12} style={{ marginTop: 'var(--space-2)' }} />
        <Bone w="70%" h={12} />
    </div>
);

/* 2, an Up next card, is not drawn: Up next shows once its cards are in. */

/** 3. A bucket card (EmailCard). */
export const BucketCardSkeleton = () => (
    <div style={{ ...card, height: 172, padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
        <Bone w="40%" h={12} />
        <Bone w="75%" h={18} />
        <Bone w="95%" h={12} style={{ marginTop: 'var(--space-1)' }} />
        <Bone w="85%" h={12} />
        <Bone w="55%" h={12} />
    </div>
);

/** 4. An Archive row (ArchiveItem). */
export const ArchiveRowSkeleton = () => (
    <div style={{ ...card, height: 108, padding: 'var(--space-6)', flexDirection: 'row', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', flex: 1 }}>
            <Bone w="25%" h={14} style={{ marginTop: 'var(--space-1)' }} />
            <Bone w="55%" h={14} />
        </span>
        <Bone w={90} h={10} style={{ marginTop: 'var(--space-1)' }} />
    </div>
);

/** 5. A search result. */
export const SearchResultSkeleton = () => (
    <div style={{ ...card, height: 120, padding: 'var(--card-padding)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', flex: 1 }}>
            <Bone w="50%" h={14} />
            <Bone w="22%" h={12} />
            <Bone w="14%" h={10} />
        </span>
        <Bone w={48} h={12} />
    </div>
);

/** 6. A message body. */
export const BodySkeleton: React.FC<{ minHeight: number }> = ({ minHeight }) => (
    <div aria-busy="true" style={{ minHeight, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-1)' }}>
        <AfterDelay>
            {[92, 88, 96, 70, 0, 85, 90, 64].map((w, i) => (w ? <Bone key={i} w={`${w}%`} h={12} /> : <span key={i} style={{ height: 8 }} />))}
        </AfterDelay>
    </div>
);

/** Try again, on every failure: the shared small secondary Button. */
const TryAgain: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <Button size="sm" onClick={e => { e.stopPropagation(); onClick(); }}>Try again</Button>
);

/**
 * A list that couldn't load (the Inbox, a bucket, the Archive; board P7, change 1): what and why, in
 * one sentence, centred where the list would be, in secondary text at the list's size, with Try again.
 */
export const ViewFailure: React.FC<{ what: string; why: string; onRetry: () => void; room?: string }> = ({ what, why, onRetry, room = 'var(--space-16)' }) => (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', padding: room, textAlign: 'center', color: 'var(--text-3)' }}>
        <p>Couldn't load {what}. {why}</p>
        <TryAgain onClick={onRetry} />
    </div>
);

/** A message body that failed: only that part is replaced. */
export const BodyFailure: React.FC<{ onRetry: () => void; minHeight: number }> = ({ onRetry, minHeight }) => (
    <div role="alert" style={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)', paddingTop: 'var(--space-1)' }}>
        <p style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)' }}>
            Couldn't load this message. The rest of the thread is still here.
        </p>
        <TryAgain onClick={onRetry} />
    </div>
);

/** A page of a list that failed to load: what's already loaded stays. */
export const ListFailure: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-6)' }}>
        <span style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)' }}>Couldn't load more.</span>
        <TryAgain onClick={onRetry} />
    </div>
);
