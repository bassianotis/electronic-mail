import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { DURATION, tween } from '../../utils/motion';
import { Plus, Edit2, Trash2, Archive } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { CreateBucketModal } from './CreateBucketModal';
import { BucketGlyph } from './BucketGlyph';
import { RAIL_WIDTH } from '../Layout/AccountRail';
import { api, paths } from '../../api/client';
import type { Bucket } from '../../store/mailStore';
import { formatCount } from '../../utils/format';

interface BucketsDockProps {
    activeBucket: string;
    onSelect: (id: string) => void;
}

export const BucketsDock: React.FC<BucketsDockProps> = ({ activeBucket, onSelect }) => {
    const { buckets, addBucket, updateBucket, deleteBucket, reorderBuckets, activeAccountId } = useMail();
    const { hoveredBucketId } = useDragDrop();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBucketId, setEditingBucketId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; bucketId: string } | null>(null);

    // Sort buckets by sortOrder, fallback to ID
    const visibleBuckets = buckets
        .filter(b => b.id !== 'inbox')
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const handleCreate = (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => {
        addBucket(label, color, emoji, showBadge, showOnHome, autoArchiveDays);
    };

    const handleUpdate = (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => {
        if (editingBucketId) {
            updateBucket(editingBucketId, { label, color, emoji: emoji || undefined, showBadge, showOnHome, autoArchiveDays });
            setEditingBucketId(null);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, bucketId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, bucketId });
    };

    const handleDelete = (id: string) => {
        const bucket = buckets.find(b => b.id === id);
        if (!bucket) return;
        const what = bucket.count ? ` Its ${formatCount(bucket.count)} thread${bucket.count === 1 ? '' : 's'} will move to the Archive.` : '';
        if (!confirm(`Delete the bucket "${bucket.label}"?${what}`)) return;
        if (activeBucket === id) {
            onSelect('inbox');
        }
        void deleteBucket(id);
    };

    const handleReorder = (newOrder: typeof visibleBuckets) => {
        const bucketIds = newOrder.map(b => b.id);
        reorderBuckets(bucketIds);
    };

    const editingBucket = buckets.find(b => b.id === editingBucketId);
    const editingLabel = editingBucket?.label;

    // What a change to the edited bucket's "Archive threads older than N days" would archive now
    const countOld = useCallback(async (days: number) => {
        const r = await api.get<{ count: number }>(`${paths.bucket(activeAccountId ?? '', editingLabel ?? '')}/old-items?days=${days}`);
        return r.count;
    }, [activeAccountId, editingLabel]);

    return (
        <>
            {/* The slim bar: buckets are rows in a strip that scrolls sideways (never wraps); the "+" and
                Archive stay at its end. Drag and drop, reordering and right-click → Edit bucket. */}
                <div style={{
                    position: 'fixed',
                    bottom: 'var(--space-lg)',
                    left: `calc(50% + ${RAIL_WIDTH / 2}px)`,
                    transform: 'translateX(-50%)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    maxWidth: `calc(100vw - ${RAIL_WIDTH}px - 48px)`,
                    padding: '4px',
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px'
                }}>
                    <Reorder.Group
                        id="bucket-strip"
                        axis="x"
                        values={visibleBuckets}
                        onReorder={handleReorder}
                        layoutScroll
                        onWheel={e => {
                            // A mouse wheel scrolls the strip sideways
                            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
                        }}
                        style={{ display: 'flex', gap: '2px', listStyle: 'none', padding: 0, margin: 0, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}
                    >
                        {visibleBuckets.map((bucket) => (
                            <Reorder.Item key={bucket.id} value={bucket} style={{ cursor: 'grab', flexShrink: 0 }}>
                                <DockRow
                                    bucket={bucket}
                                    isActive={activeBucket === bucket.id}
                                    isDropTarget={hoveredBucketId === bucket.id}
                                    onClick={() => onSelect(activeBucket === bucket.id ? 'inbox' : bucket.id)}
                                    onContextMenu={(e) => handleContextMenu(e, bucket.id)}
                                />
                            </Reorder.Item>
                        ))}
                    </Reorder.Group>
                    <button
                        type="button"
                        className="dock-row"
                        title="New bucket"
                        aria-label="New bucket"
                        onClick={() => {
                            setEditingBucketId(null);
                            setIsModalOpen(true);
                        }}
                        style={{ ...dockRow, width: '36px', padding: 0, justifyContent: 'center', color: 'var(--color-text-faint)' }}
                    >
                        <Plus size={16} aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" style={{ width: '1px', height: '20px', margin: '0 4px', backgroundColor: 'var(--color-border)', flexShrink: 0 }} />
                    <button
                        id="archive-target"
                        type="button"
                        className="dock-row"
                        onClick={() => onSelect(activeBucket === 'archive' ? 'inbox' : 'archive')}
                        style={{
                            ...dockRow,
                            ...rowLook(activeBucket === 'archive', hoveredBucketId === 'archive'),
                            color: activeBucket === 'archive' ? 'var(--color-text-main)' : 'var(--color-text-muted)'
                        }}
                    >
                        <Archive size={14} aria-hidden="true" />
                        Archive
                    </button>
                </div>

            {/* Context Menu */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={tween(DURATION.mid)} // menus: 200ms (utils/motion.ts)
                        style={{
                            position: 'fixed',
                            top: contextMenu.y - 100, // Show above cursor
                            left: contextMenu.x,
                            backgroundColor: 'var(--surface-raised)',
                            borderRadius: 'var(--radius-md)',
                            padding: '8px',
                            boxShadow: 'var(--shadow-dialog)',
                            zIndex: 200,
                            minWidth: '152px',
                            border: '1px solid var(--border-strong)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => {
                                setEditingBucketId(contextMenu.bucketId);
                                setIsModalOpen(true);
                                setContextMenu(null);
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                width: '100%',
                                padding: '8px 12px',
                                border: 'none',
                                background: 'none',
                                borderRadius: 'max(4px, calc(var(--radius-md) - 8px))',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-main)',
                                textAlign: 'left'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Edit2 size={16} /> Edit
                        </button>
                        <button
                            onClick={() => {
                                handleDelete(contextMenu.bucketId);
                                setContextMenu(null);
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                width: '100%',
                                padding: '8px 12px',
                                border: 'none',
                                background: 'none',
                                borderRadius: 'max(4px, calc(var(--radius-md) - 8px))',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--badge-red)',
                                textAlign: 'left'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--menu-danger-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Trash2 size={16} /> Delete
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <CreateBucketModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingBucketId(null);
                }}
                onSave={editingBucketId ? handleUpdate : handleCreate}
                initialLabel={editingBucket?.label}
                initialColor={editingBucket?.color}
                initialEmoji={editingBucket?.emoji}
                initialShowBadge={editingBucket?.showBadge}
                initialShowOnHome={editingBucket?.showOnHome}
                initialAutoArchiveDays={editingBucket?.autoArchiveDays ?? null}
                countOld={editingBucket && activeAccountId ? countOld : undefined}
                mode={editingBucketId ? 'edit' : 'create'}
            />
        </>
    );
};

/** A row in the slim bar (bucket or Archive): its hover fill is .dock-row:hover in index.css. */
const dockRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '36px',
    padding: '0 16px',
    borderRadius: '4px', // the bar's 8 minus its 4px padding
    border: 'none',
    fontFamily: 'inherit',
    fontSize: '13px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flexShrink: 0
};

/** A row's fill and ring: the hover fill when open or a card is over it (plus a 1px amber ring).
 * Highlights ease in over 120ms. */
const rowLook = (active: boolean, dropTarget: boolean): React.CSSProperties => ({
    background: active || dropTarget ? 'var(--color-bg-hover)' : undefined,
    boxShadow: dropTarget ? 'inset 0 0 0 1px var(--color-action)' : 'none',
    transition: 'background-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)'
});

/** A bucket in the slim bar: greyscale glyph, label, and its count when the badge is on. Dragging a
 * card over it shows the hover fill and a 1px amber ring. */
const DockRow = ({ bucket, isActive, isDropTarget, onClick, onContextMenu }: { bucket: Bucket, isActive: boolean, isDropTarget: boolean, onClick: () => void, onContextMenu: (e: React.MouseEvent) => void }) => (
    <button
        id={`bucket-target-${bucket.id}`}
        type="button"
        className="dock-row"
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={{
            ...dockRow,
            ...rowLook(isActive, isDropTarget),
            color: isActive ? 'var(--color-text-main)' : 'var(--color-text-muted)'
        }}
    >
        <span style={{ display: 'inline-flex', color: 'var(--color-text-faint)' }}>
            <BucketGlyph stored={bucket.emoji} label={bucket.label} size={16} fallbackStyle={{ fontSize: '14px', lineHeight: 1, filter: 'grayscale(1)', opacity: 0.55 }} />
        </span>
        {bucket.label}
        {bucket.showBadge && bucket.count > 0 && (
            <span style={{ color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>{formatCount(bucket.count)}</span>
        )}
    </button>
);
