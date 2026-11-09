import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, Reorder, useReducedMotion } from 'framer-motion';
import { Plus, Edit2, Trash2, Archive } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { CreateBucketModal } from './CreateBucketModal';
import { BucketGlyph } from './BucketGlyph';
import { RAIL_WIDTH } from '../Layout/AccountRail';
import { api, paths } from '../../api/client';
import { useDragStyle, useTheme } from '../../utils/theme';
import type { Bucket } from '../../store/mailStore';
import { DURATION, tween } from '../../utils/motion';
import { formatCount } from '../../utils/format';

interface BucketsDockProps {
    activeBucket: string;
    onSelect: (id: string) => void;
}

export const BucketsDock: React.FC<BucketsDockProps> = ({ activeBucket, onSelect }) => {
    const { buckets, addBucket, updateBucket, deleteBucket, reorderBuckets, activeAccountId } = useMail();
    const { hoveredBucketId, isDragging, landed } = useDragDrop();
    const dark = useTheme() === 'dark';
    // "New" drag (Appearance → Drag): while a card is dragged, the bar rises and its rows show as targets
    const dragStyle = useDragStyle();
    const showTargets = dark && dragStyle === 'new' && isDragging;
    const reduced = !!useReducedMotion();
    const archiveFlash = useFlash(landed?.target === 'archive' ? landed.at : null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBucketId, setEditingBucketId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; bucketId: string } | null>(null);
    const [localHoveredId, setLocalHoveredId] = useState<string | null>(null);

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
            {dark ? (
                /* Dark (the Instrument trial): the reference's slim bar. Buckets are rows in a strip that scrolls
                   sideways (never wraps); the "+" and Archive stay at its end. Drag and drop, reordering and
                   right-click → Edit bucket work as on the tiles. */
                <div style={{
                    position: 'fixed',
                    bottom: 'var(--space-lg)',
                    left: `calc(50% + ${RAIL_WIDTH / 2}px)`,
                    transform: showTargets && !reduced ? 'translateX(-50%) translateY(-4px)' : 'translateX(-50%)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    maxWidth: `calc(100vw - ${RAIL_WIDTH}px - 48px)`,
                    padding: '4px',
                    backgroundColor: 'var(--surface-card)',
                    border: `1px solid ${showTargets ? 'var(--border-strong)' : 'var(--color-border)'}`,
                    borderRadius: '8px',
                    transition: 'transform var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
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
                                    outlined={showTargets}
                                    landed={landed?.target === bucket.id ? landed.at : null}
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
                            ...rowLook(activeBucket === 'archive', hoveredBucketId === 'archive', showTargets, archiveFlash),
                            color: activeBucket === 'archive' ? 'var(--color-text-main)' : 'var(--color-text-muted)'
                        }}
                    >
                        <Archive size={14} aria-hidden="true" />
                        Archive
                    </button>
                </div>
            ) : (
                <div style={{
                    position: 'fixed',
                    bottom: 'var(--space-lg)',
                    left: `calc(50% + ${RAIL_WIDTH / 2}px)`, // centred on the content, beside the account rail
                    transform: 'translateX(-50%)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-sm) var(--space-md)',
                    backgroundColor: 'var(--dock-glass)',
                    backdropFilter: 'blur(var(--blur-dock))',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-floating)',
                    border: '1px solid var(--dock-glass-border)'
                }}>
                    <Reorder.Group
                        axis="x"
                        values={visibleBuckets}
                        onReorder={handleReorder}
                        style={{
                            display: 'flex',
                            gap: 'var(--space-sm)',
                            listStyle: 'none',
                            padding: 0,
                            margin: 0
                        }}
                    >
                        {visibleBuckets.map((bucket) => (
                            <Reorder.Item
                                key={bucket.id}
                                value={bucket}
                                style={{
                                    cursor: 'grab',
                                    position: 'relative'
                                }}
                                animate={{
                                    zIndex: (hoveredBucketId === bucket.id || localHoveredId === bucket.id) ? 100 : 1
                                }}
                                onMouseEnter={() => setLocalHoveredId(bucket.id)}
                                onMouseLeave={() => setLocalHoveredId(null)}
                            >
                                <DockItem
                                    bucket={bucket}
                                    isActive={activeBucket === bucket.id}
                                    isHovered={hoveredBucketId === bucket.id || localHoveredId === bucket.id}
                                    onClick={() => {
                                        if (activeBucket === bucket.id) {
                                            onSelect('inbox');
                                        } else {
                                            onSelect(bucket.id);
                                        }
                                    }}
                                    onContextMenu={(e) => handleContextMenu(e, bucket.id)}
                                />
                            </Reorder.Item>
                        ))}
                    </Reorder.Group>

                    {/* Plus Icon (before divider) */}
                    <motion.button
                        whileHover={{ scale: 1.1, backgroundColor: 'var(--color-bg-hover)' }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                            setEditingBucketId(null);
                            setIsModalOpen(true);
                        }}
                        style={{
                            width: 'var(--dock-small-tile)',
                            height: 'var(--dock-small-tile)',
                            borderRadius: 'var(--radius-tile)',
                            backgroundColor: 'transparent',
                            border: 'var(--dock-plus-border)',
                            color: 'var(--dock-plus-text)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            marginBottom: '4px'
                        }}
                    >
                        <Plus size={20} />
                    </motion.button>

                    <div style={{ width: '1px', height: '40px', backgroundColor: 'var(--color-border)', margin: '0 8px' }} />

                    {/* Archive Icon (after divider) */}
                    <motion.button
                        id="archive-target"
                        onClick={() => {
                            if (activeBucket === 'archive') {
                                onSelect('inbox');
                            } else {
                                onSelect('archive');
                            }
                        }}
                        whileHover={{ scale: activeBucket === 'archive' ? 1.15 : 1.1 }}
                        whileTap={{ scale: 0.97 }}
                        animate={{
                            scale: hoveredBucketId === 'archive' ? 1.4 : 1,
                            y: hoveredBucketId === 'archive' ? -10 : 0
                        }}
                        style={{
                            width: 'var(--dock-small-tile)',
                            height: 'var(--dock-small-tile)',
                            borderRadius: 'var(--radius-tile)',
                            backgroundColor: activeBucket === 'archive' ? 'var(--archive-tile-active)' : 'transparent',
                            color: activeBucket === 'archive' ? 'var(--color-on-accent)' : 'var(--color-text-muted)',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            marginBottom: '4px',
                            transition: 'background-color var(--dur-fast) var(--ease)'
                        }}
                    >
                        <Archive size={20} />
                    </motion.button>
                </div>
            )}

            {/* Context Menu */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
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

/** A row in the dark theme's slim bar (bucket or Archive): its hover fill is .dock-row:hover in index.css. */
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

/** A row's fill and ring: the hover fill when open or a card is over it (plus a 1px amber ring), a
 * faint outline while a "New" drag shows the targets, a brief amber flash when a card lands on it.
 * Highlights ease in over 120ms. */
const rowLook = (active: boolean, dropTarget: boolean, outlined: boolean, flashing: boolean): React.CSSProperties => ({
    background: flashing ? 'color-mix(in srgb, var(--color-action) 16%, transparent)' : active || dropTarget ? 'var(--color-bg-hover)' : undefined,
    boxShadow: dropTarget || flashing ? 'inset 0 0 0 1px var(--color-action)' : outlined ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.07)' : 'none',
    transition: 'background-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)'
});

/** True for a moment after a card lands on the row (`at`: when; null: not this row). */
function useFlash(at: number | null): boolean {
    const [on, setOn] = useState(false);
    useEffect(() => {
        if (at === null) return;
        setOn(true); // eslint-disable-line react-hooks/set-state-in-effect -- a timed flash
        const t = setTimeout(() => setOn(false), 450);
        return () => clearTimeout(t);
    }, [at]);
    return on;
}

/** A bucket in the slim bar: greyscale glyph, label, and its count when the badge is on. Dragging a
 * card over it shows the hover fill and a 1px amber ring; a card landing on it ("New" drag) ticks
 * its count up with an amber flash before the engine's count arrives. */
const DockRow = ({ bucket, isActive, isDropTarget, outlined, landed, onClick, onContextMenu }: { bucket: Bucket, isActive: boolean, isDropTarget: boolean, outlined: boolean, landed: number | null, onClick: () => void, onContextMenu: (e: React.MouseEvent) => void }) => {
    const flashing = useFlash(landed);
    // The tick: one more until the engine's count changes (or a few seconds pass)
    const [tick, setTick] = useState<{ at: number; from: number } | null>(null);
    useEffect(() => {
        if (landed === null) return;
        setTick({ at: landed, from: bucket.count });
        const t = setTimeout(() => setTick(null), 4000);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [landed]);
    const count = tick && bucket.count === tick.from ? bucket.count + 1 : bucket.count;
    return (
        <button
            id={`bucket-target-${bucket.id}`}
            type="button"
            className="dock-row"
            onClick={onClick}
            onContextMenu={onContextMenu}
            style={{
                ...dockRow,
                ...rowLook(isActive, isDropTarget, outlined, flashing),
                color: isActive ? 'var(--color-text-main)' : 'var(--color-text-muted)'
            }}
        >
            <span style={{ display: 'inline-flex', color: 'var(--color-text-faint)' }}>
                <BucketGlyph stored={bucket.emoji} label={bucket.label} size={16} fallbackStyle={{ fontSize: '14px', lineHeight: 1, filter: 'grayscale(1)', opacity: 0.55 }} />
            </span>
            {bucket.label}
            {bucket.showBadge && count > 0 && (
                <span style={{ color: flashing ? 'var(--color-action)' : 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums', transition: 'color var(--dur-fast) var(--ease)' }}>{formatCount(count)}</span>
            )}
        </button>
    );
};

const DockItem = ({ bucket, isActive, isHovered, onClick, onContextMenu }: { bucket: any, isActive: boolean, isHovered: boolean, onClick: () => void, onContextMenu: (e: React.MouseEvent) => void }) => {
    const ref = useRef<HTMLButtonElement>(null);

    return (
        <motion.button
            ref={ref}
            id={`bucket-target-${bucket.id}`}
            onClick={onClick}
            onContextMenu={onContextMenu}
            animate={{
                scale: isHovered ? 1.4 : 1,
                y: isHovered ? -10 : 0
            }}
            transition={tween(DURATION.fast)}
            whileHover={{
                scale: 1.2,
                y: -5,
                transition: tween(DURATION.fast)
            }}
            whileTap={{ scale: 0.97 }}
            style={{
                position: 'relative',
                width: 'var(--dock-tile)',
                height: 'var(--dock-tile)',
                borderRadius: 'var(--radius-tile)',
                // The dark theme sets the --dock-tile tokens (no bucket colours); light falls back to the bucket's own.
                backgroundColor: isActive || isHovered ? `var(--dock-tile-active, ${bucket.color})` : 'var(--color-bg-subtle)',
                color: isActive || isHovered ? 'var(--dock-tile-active-text, var(--color-on-accent))' : `var(--dock-tile-text, ${bucket.color})`,
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: bucket.count > 0
                    ? `var(--dock-tile-ring, 0 0 0 3px ${bucket.color}20), var(--shadow-lift)`
                    : (isActive || isHovered ? 'var(--shadow-lift)' : 'none'),
                transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)'
            }}
        >
            {bucket.showBadge && bucket.count > 0 && (
                <div style={{
                    position: 'absolute',
                    top: 'var(--dock-count-inset)',
                    right: 'var(--dock-count-inset)',
                    backgroundColor: 'var(--dock-count-bg)',
                    color: 'var(--dock-count-text)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--weight-bold)',
                    fontVariantNumeric: 'tabular-nums',
                    padding: 'var(--dock-count-pad)',
                    borderRadius: 'var(--radius-full)',
                    boxShadow: 'var(--shadow-badge)',
                    zIndex: 2,
                    border: 'var(--dock-count-border)'
                }}>
                    {bucket.count > 99 ? '99+' : bucket.count}
                </div>
            )}
            <BucketGlyph stored={bucket.emoji} label={bucket.label} size={20}
                fallbackStyle={{ fontSize: bucket.emoji ? '24px' : '20px', fontWeight: 'var(--weight-bold)', lineHeight: 1, filter: 'var(--dock-emoji-filter)', opacity: 'var(--dock-emoji-opacity)' }} />

            <span style={{
                fontSize: 'var(--font-size-2xs)',
                fontWeight: 'var(--weight-semibold)',
                marginTop: '2px',
                opacity: isActive || isHovered ? 1 : 0.7
            }}>
                {bucket.label}
            </span>
        </motion.button>
    );
};
