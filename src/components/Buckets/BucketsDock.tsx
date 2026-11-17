import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { DURATION, leave, tween } from '../../utils/motion';
import { Plus, Edit2, Trash2, Archive } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { CreateBucketModal } from './CreateBucketModal';
import { BucketGlyph } from './BucketGlyph';
import { RAIL_WIDTH } from '../Layout/AccountRail';
import { api, paths } from '../../api/client';
import type { Bucket } from '../../store/mailStore';
import { formatCount } from '../../utils/format';
import { Z } from '../../utils/layers';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';

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

    // The menu (WAI-ARIA menu, board C1): its first item takes the focus, the arrow keys move, Tab or
    // Esc (rule L4) close it and the focus goes back to its row
    const rowOf = (id: string) => document.getElementById(`bucket-target-${id}`);
    const closeMenu = () => {
        const row = contextMenu && rowOf(contextMenu.bucketId);
        setContextMenu(null);
        row?.focus();
    };

    const handleCreate = (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => {
        addBucket(label, color, emoji, showBadge, showOnHome, autoArchiveDays);
    };

    const handleUpdate = (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => {
        if (editingBucketId) {
            updateBucket(editingBucketId, { label, color, emoji: emoji || undefined, showBadge, showOnHome, autoArchiveDays });
            setEditingBucketId(null);
        }
    };

    // Right-click: at the pointer. From the keyboard (Shift+F10, the menu key): at the row.
    const handleContextMenu = (e: React.MouseEvent, bucketId: string) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const atPointer = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        setContextMenu(atPointer ? { x: e.clientX, y: e.clientY, bucketId } : { x: r.left, y: r.top, bucketId });
    };
    const handleMenuKey = (e: React.KeyboardEvent, bucketId: string) => {
        if (!(e.key === 'F10' && e.shiftKey) && e.key !== 'ContextMenu') return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setContextMenu({ x: r.left, y: r.top, bucketId });
    };

    // At once, with Undo on the notice (rule A1; MailContext.deleteBucket). The focus moves to the
    // next row, as it leaves the strip (rule K7).
    const handleDelete = (id: string) => {
        const bucket = buckets.find(b => b.id === id);
        if (!bucket) return;
        const rows = visibleBuckets.map(b => b.id);
        const at = rows.indexOf(id);
        const next = rows[at + 1] ?? rows[at - 1];
        if (activeBucket === id) {
            onSelect('inbox');
        }
        void deleteBucket(id);
        if (document.activeElement === rowOf(id)) (next ? rowOf(next) : document.getElementById('archive-target'))?.focus();
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
                    bottom: 'var(--space-6)',
                    left: `calc(50% + ${RAIL_WIDTH / 2}px)`,
                    transform: 'translateX(-50%)',
                    zIndex: Z.chrome.dock,
                    display: 'flex',
                    alignItems: 'center',
                    maxWidth: `calc(100vw - ${RAIL_WIDTH}px - 48px)`,
                    padding: 'var(--space-1)',
                    backgroundColor: 'var(--surface-1)',
                    border: '1px solid var(--line-1)',
                    borderRadius: 'var(--radius-3)'
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
                                    onKeyDown={(e) => handleMenuKey(e, bucket.id)}
                                />
                            </Reorder.Item>
                        ))}
                    </Reorder.Group>
                    <Tooltip content="New bucket" placement="above">
                        <button
                            type="button"
                            className="dock-row"
                            aria-label="New bucket"
                            onClick={() => {
                                setEditingBucketId(null);
                                setIsModalOpen(true);
                            }}
                            style={{ ...dockRow, width: '36px', padding: 0, justifyContent: 'center', color: 'var(--text-4)' }}
                        >
                            <Plus size={16} aria-hidden="true" />
                        </button>
                    </Tooltip>
                    <span aria-hidden="true" style={{ width: '1px', height: '20px', margin: '0 var(--space-1)', backgroundColor: 'var(--line-1)', flexShrink: 0 }} />
                    <button
                        id="archive-target"
                        type="button"
                        className="dock-row"
                        onClick={() => onSelect(activeBucket === 'archive' ? 'inbox' : 'archive')}
                        style={{
                            ...dockRow,
                            ...rowLook(activeBucket === 'archive', hoveredBucketId === 'archive'),
                            color: activeBucket === 'archive' ? 'var(--text-1)' : 'var(--text-3)'
                        }}
                    >
                        <Archive size={14} aria-hidden="true" />
                        Archive
                    </button>
                </div>

            {/* The bucket's menu (the shared Menu): Edit, then Delete last, after a separator */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        key="dock-menu"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9, transition: leave(DURATION.instant) }}
                        transition={tween(DURATION.mid)} // menus: in 200ms, out 100 on the exit curve (utils/motion.ts)
                        style={{ position: 'fixed', top: contextMenu.y - 100 /* above the pointer */, left: contextMenu.x, zIndex: Z.popover.dockMenu }}
                    >
                        <Menu label={buckets.find(b => b.id === contextMenu.bucketId)?.label ?? 'Bucket'} style={{ minWidth: 152 }}
                            onClose={() => setContextMenu(null)} returnFocus={() => rowOf(contextMenu.bucketId)}
                            onTab={e => { e.preventDefault(); closeMenu(); }}>
                            <MenuItem icon={<Edit2 size={16} aria-hidden="true" />} onSelect={() => {
                                rowOf(contextMenu.bucketId)?.focus(); // what the dialog goes back to
                                setEditingBucketId(contextMenu.bucketId);
                                setIsModalOpen(true);
                                setContextMenu(null);
                            }}>Edit</MenuItem>
                            <MenuSeparator />
                            <MenuItem danger icon={<Trash2 size={16} aria-hidden="true" />} onSelect={() => {
                                rowOf(contextMenu.bucketId)?.focus();
                                handleDelete(contextMenu.bucketId);
                                setContextMenu(null);
                            }}>Delete</MenuItem>
                        </Menu>
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
    gap: 'var(--space-2)',
    height: '36px',
    padding: '0 var(--space-4)',
    borderRadius: 'var(--radius-1)', // the bar's 8 minus its 4px padding
    border: 'none',
    fontFamily: 'inherit',
    fontSize: 'var(--size-small)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flexShrink: 0
};

/** A row's fill and ring: the hover fill when open or a card is over it (plus a 1px amber ring).
 * Highlights ease in over 120ms. */
const rowLook = (active: boolean, dropTarget: boolean): React.CSSProperties => ({
    background: active || dropTarget ? 'var(--fill-hover)' : undefined,
    boxShadow: dropTarget ? 'inset 0 0 0 1px var(--action)' : 'none',
    transition: 'background-color var(--dur-instant) var(--ease-in), box-shadow var(--dur-instant) var(--ease-in)'
});

/** A bucket in the slim bar: greyscale glyph, label, and its count when the badge is on. Dragging a
 * card over it shows the hover fill and a 1px amber ring. */
const DockRow = ({ bucket, isActive, isDropTarget, onClick, onContextMenu, onKeyDown }: { bucket: Bucket, isActive: boolean, isDropTarget: boolean, onClick: () => void, onContextMenu: (e: React.MouseEvent) => void, onKeyDown: (e: React.KeyboardEvent) => void }) => (
    <button
        id={`bucket-target-${bucket.id}`}
        type="button"
        className="dock-row"
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        style={{
            ...dockRow,
            ...rowLook(isActive, isDropTarget),
            color: isActive ? 'var(--text-1)' : 'var(--text-3)'
        }}
    >
        <span style={{ display: 'inline-flex', color: 'var(--text-4)' }}>
            <BucketGlyph stored={bucket.emoji} label={bucket.label} size={16} fallbackStyle={{ fontSize: 'var(--size-body)', lineHeight: 1, filter: 'grayscale(1)', opacity: 0.55 }} />
        </span>
        {bucket.label}
        {bucket.showBadge && bucket.count > 0 && (
            <span style={{ color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>{formatCount(bucket.count)}</span>
        )}
    </button>
);
