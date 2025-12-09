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
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    backdropFilter: 'blur(4px)'
                }}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '16px',
                        padding: '32px',
                        width: '100%',
                        maxWidth: '500px',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
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
                        <X size={20} />
                    </button>

                    <h2 style={{
                        fontSize: '24px',
                        fontWeight: 700,
                        marginBottom: '24px',
                        textAlign: 'center'
                    }}>
                        How it works
                    </h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '10px',
                                borderRadius: '12px',
                                color: '#667eea'
                            }}>
                                <Inbox size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Keep your inbox clear</h3>
                                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    New, unread emails appear in your inbox. When an email arrives, archive, or bucket for later.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '10px',
                                borderRadius: '12px',
                                color: '#8b5cf6'
                            }}>
                                <ArrowDown size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Create buckets</h3>
                                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Create custom buckets that are most helpful for you.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '10px',
                                borderRadius: '12px',
                                color: '#10b981'
                            }}>
                                <Archive size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Drag to organize</h3>
                                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Drag emails to buckets to categorize them, or to the Archive if you're done with them.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{
                                background: 'var(--color-bg-subtle)',
                                padding: '10px',
                                borderRadius: '12px',
                                color: '#f59e0b'
                            }}>
                                <Settings size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Automate with rules</h3>
                                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                                    Set up rules in settings to automatically assign incoming emails to buckets.
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            width: '100%',
                            marginTop: '32px',
                            padding: '14px',
                            backgroundColor: '#667eea',
                            color: 'white',
                            border: 'none',
                            borderRadius: '12px',
                            fontSize: '16px',
                            fontWeight: 600,
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
