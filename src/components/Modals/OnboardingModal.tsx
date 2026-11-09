import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Inbox, Archive, ArrowDown, Settings } from 'lucide-react';

interface OnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'var(--tour-scrim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    backdropFilter: 'blur(var(--blur-modal))'
                }}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    style={{
                        backgroundColor: 'var(--surface-raised)',
                        borderRadius: 'var(--radius-tile)',
                        padding: '32px',
                        width: '100%',
                        maxWidth: '500px',
                        boxShadow: 'var(--shadow-tour)',
                        outline: '1px solid var(--dialog-edge)',
                        position: 'relative'
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: '16px',
                            right: '16px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-muted)'
                        }}
                    >
                        <X size={16} />
                    </button>

                    <h2 style={{
                        fontSize: 'var(--font-size-2xl)',
                        fontWeight: 'var(--weight-bold)',
                        marginBottom: '24px',
                        textAlign: 'center'
                    }}>
                        How it works
                    </h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-control)',
                                color: 'var(--color-action)'
                            }}>
                                <Inbox size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)', marginBottom: '4px' }}>Keep your inbox clear</h3>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    New mail lands in your inbox. Archive it, or file it in a bucket for later.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-control)',
                                color: 'var(--color-action)'
                            }}>
                                <ArrowDown size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)', marginBottom: '4px' }}>Create buckets</h3>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Create custom buckets that are most helpful for you
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-control)',
                                color: 'var(--color-action)'
                            }}>
                                <Archive size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)', marginBottom: '4px' }}>Drag to organize</h3>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Drag emails to buckets to categorize them, or to the Archive if you're done with them
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '8px',
                                borderRadius: 'var(--radius-control)',
                                color: 'var(--color-action)'
                            }}>
                                <Settings size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)', marginBottom: '4px' }}>Automate with rules</h3>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Set up rules in settings to automatically assign incoming emails to buckets
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            width: '100%',
                            marginTop: '32px',
                            padding: '12px',
                            backgroundColor: 'var(--color-action)',
                            color: 'var(--color-on-action)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-size-base)',
                            fontWeight: 'var(--weight-semibold)',
                            cursor: 'pointer'
                        }}
                    >
                        Got it
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
