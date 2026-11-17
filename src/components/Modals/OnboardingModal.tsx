import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Inbox, Archive, ArrowDown, Settings } from 'lucide-react';
import { useEscape, useModal, Z } from '../../utils/layers';

interface OnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
    // Modal (rule L3): the focus moves in, Tab stays inside, the page behind is inert, and closing
    // goes back to where it was
    const layer = useRef<HTMLDivElement>(null);
    const box = useRef<HTMLDivElement>(null);
    // The dialog itself takes the focus (it has no field), so no ring shows on its × before a key
    useModal(layer, isOpen, { initial: () => box.current });
    useEscape(isOpen, 'dialog', onClose); // rule L4
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                ref={layer}
                data-layer="dialog"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'var(--scrim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: Z.dialog.tour
                }}
            >
                <motion.div
                    ref={box}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="tour-title"
                    tabIndex={-1}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    style={{
                        backgroundColor: 'var(--surface-raised)',
                        borderRadius: 'var(--radius-3)',
                        padding: 'var(--space-8)',
                        width: '100%',
                        maxWidth: '500px',
                        boxShadow: 'var(--shadow-overlay)',
                        outline: '1px solid var(--line-2)',
                        position: 'relative'
                    }}
                >
                    <button
                        type="button"
                        aria-label="Close"
                        title="Close"
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: '16px',
                            right: '16px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-3)'
                        }}
                    >
                        <X size={16} aria-hidden="true" />
                    </button>

                    <h2 id="tour-title" style={{
                        fontSize: 'var(--size-page)',
                        fontWeight: 'var(--weight-medium)',
                        marginBottom: 'var(--space-6)',
                        textAlign: 'center'
                    }}>
                        How it works
                    </h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--surface-1)',
                                padding: 'var(--space-2)',
                                borderRadius: 'var(--radius-2)',
                                color: 'var(--action)'
                            }}>
                                <Inbox size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--size-large)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Keep your inbox clear</h3>
                                <p style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)', lineHeight: '1.5' }}>
                                    New mail lands in your inbox. Archive it, or file it in a bucket for later.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--surface-1)',
                                padding: 'var(--space-2)',
                                borderRadius: 'var(--radius-2)',
                                color: 'var(--action)'
                            }}>
                                <ArrowDown size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--size-large)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Create buckets</h3>
                                <p style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)', lineHeight: '1.5' }}>
                                    Create custom buckets that are most helpful for you
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--surface-1)',
                                padding: 'var(--space-2)',
                                borderRadius: 'var(--radius-2)',
                                color: 'var(--action)'
                            }}>
                                <Archive size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--size-large)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Drag to organize</h3>
                                <p style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)', lineHeight: '1.5' }}>
                                    Drag emails to buckets to categorize them, or to the Archive if you're done with them
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--surface-1)',
                                padding: 'var(--space-2)',
                                borderRadius: 'var(--radius-2)',
                                color: 'var(--action)'
                            }}>
                                <Settings size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--size-large)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Automate with rules</h3>
                                <p style={{ fontSize: 'var(--size-body)', color: 'var(--text-3)', lineHeight: '1.5' }}>
                                    Set up rules in settings to automatically assign incoming emails to buckets
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            width: '100%',
                            marginTop: 'var(--space-8)',
                            padding: 'var(--space-3)',
                            backgroundColor: 'var(--action)',
                            color: 'var(--on-action)',
                            border: 'none',
                            borderRadius: 'var(--radius-3)',
                            fontSize: 'var(--size-large)',
                            fontWeight: 'var(--weight-medium)',
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
