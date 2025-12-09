import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Plus, Edit2, Trash2, Archive } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { CreateBucketModal } from './CreateBucketModal';

interface BucketsDockProps {
    activeBucket: string;
    onSelect: (id: string) => void;
}

export const BucketsDock: React.FC<BucketsDockProps> = ({ activeBucket, onSelect }) => {
    const { buckets, addBucket, updateBucket, deleteBucket, reorderBuckets } = useMail();
    const { hoveredBucketId } = useDragDrop();

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

    const handleCreate = (label: string, color: string) => {
        addBucket(label, color);
    };

    const handleUpdate = (label: string, color: string) => {
        if (editingBucketId) {
            updateBucket(editingBucketId, { label, color });
            setEditingBucketId(null);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, bucketId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, bucketId });
    };

    const handleDelete = (id: string) => {
        if (activeBucket === id) {
            onSelect('inbox');
        }
        deleteBucket(id);
    };

    const handleReorder = (newOrder: typeof visibleBuckets) => {
        const bucketIds = newOrder.map(b => b.id);
        reorderBuckets(bucketIds);
    };

    const editingBucket = buckets.find(b => b.id === editingBucketId);

    return (
        <>
            <div style={{
                position: 'fixed',
                bottom: 'var(--space-lg)',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
                display: 'flex',
                alignItems: 'flex-end',
                gap: 'var(--space-sm)',
                padding: 'var(--space-sm) var(--space-md)',
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(12px)',
                borderRadius: '24px',
                boxShadow: 'var(--shadow-floating)',
                border: '1px solid rgba(255,255,255,0.5)'
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
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                        setEditingBucketId(null);
                        setIsModalOpen(true);
                    }}
                    style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '16px',
                        backgroundColor: 'transparent',
                        border: '2px dashed var(--color-border)',
                        color: 'var(--color-text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        marginBottom: '4px'
                    }}
                >
                    <Plus size={24} />
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
                    whileTap={{ scale: 0.95 }}
                    animate={{
                        scale: hoveredBucketId === 'archive' ? 1.4 : 1,
                        y: hoveredBucketId === 'archive' ? -10 : 0
                    }}
                    style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '16px',
                        backgroundColor: activeBucket === 'archive' ? '#94a3b8' : 'transparent',
                        color: activeBucket === 'archive' ? '#fff' : 'var(--color-text-muted)',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        marginBottom: '4px',
                        transition: 'background-color 0.2s'
                    }}
                >
                    <Archive size={20} />
                </motion.button>
            </div>

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
                            backgroundColor: '#fff',
                            borderRadius: '12px',
                            padding: '8px',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 200,
                            minWidth: '150px',
                            border: '1px solid var(--color-border)'
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
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                color: 'var(--color-text-main)',
                                textAlign: 'left'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Edit2 size={14} /> Edit
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
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                color: '#ff3b30',
                                textAlign: 'left'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fff0f0'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Trash2 size={14} /> Delete
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
                mode={editingBucketId ? 'edit' : 'create'}
            />
        </>
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
            transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
                mass: 0.5
            }}
            whileHover={{
                scale: 1.2,
                y: -5,
                transition: { duration: 0.075, ease: "easeOut" }
            }}
            whileTap={{ scale: 0.95 }}
            style={{
                position: 'relative',
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                backgroundColor: isActive || isHovered ? bucket.color : 'var(--color-bg-subtle)',
                color: isActive || isHovered ? '#fff' : bucket.color,
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: bucket.count > 0
                    ? `0 0 0 3px ${bucket.color}20, 0 4px 12px rgba(0,0,0,0.15)`
                    : (isActive || isHovered ? '0 4px 12px rgba(0,0,0,0.15)' : 'none'),
                transition: 'all 0.2s'
            }}
        >
            <span style={{ fontSize: '20px', fontWeight: 700 }}>
                {bucket.label.charAt(0)}
            </span>

            <span style={{
                fontSize: '9px',
                fontWeight: 600,
                marginTop: '2px',
                opacity: isActive || isHovered ? 1 : 0.7
            }}>
                {bucket.label}
            </span>
        </motion.button>
    );
};
