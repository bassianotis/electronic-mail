import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface CreateBucketModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (label: string, color: string) => void;
    initialLabel?: string;
    initialColor?: string;
    mode?: 'create' | 'edit';
}

const COLORS = [
    '#ff3b30', // Red
    '#e67e22', // Orange
    '#f1c40f', // Yellow
    '#2ecc71', // Green
    '#3498db', // Blue
    '#9b59b6', // Purple
    '#95a5a6', // Gray
    '#2c3e50', // Dark
];

export const CreateBucketModal: React.FC<CreateBucketModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialLabel = '',
    initialColor = COLORS[4],
    mode = 'create'
}) => {
    const [label, setLabel] = useState(initialLabel);
    const [color, setColor] = useState(initialColor);

    // Reset state when opening
    React.useEffect(() => {
        if (isOpen) {
            setLabel(initialLabel);
            setColor(initialColor);
        }
    }, [isOpen, initialLabel, initialColor]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (label.trim()) {
            onSave(label, color);
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => {
                            if (label.trim()) {
                                onSave(label, color);
                            }
                            onClose();
                        }}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.2)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 200
                        }}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            padding: '24px',
                            width: '100%',
                            maxWidth: '400px',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 201,
                            border: '1px solid var(--color-border)'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                                {mode === 'create' ? 'New Bucket' : 'Edit Bucket'}
                            </h2>
                            <button
                                onClick={onClose}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    color: 'var(--color-text-muted)'
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    Label
                                </label>
                                <input
                                    type="text"
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder="e.g. Projects, Finance"
                                    autoFocus
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        fontSize: '16px',
                                        outline: 'none',
                                        transition: 'border-color 0.2s'
                                    }}
                                    onFocus={(e) => e.target.style.borderColor = '#667eea'}
                                    onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                                />
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    Color
                                </label>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    {COLORS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setColor(c)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                backgroundColor: c,
                                                border: color === c ? '3px solid #fff' : 'none',
                                                boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!label.trim()}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        backgroundColor: '#667eea',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: label.trim() ? 'pointer' : 'not-allowed',
                                        opacity: label.trim() ? 1 : 0.5
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
