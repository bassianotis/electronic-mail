/**
 * The little dark notices at the bottom of the screen ("Filed to Reads · Undo"), stacked when
 * several are showing. Same look as the app's original Quick Look toast.
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DURATION, tween } from '../utils/motion';
import { AlertCircle, CheckCircle, X } from 'lucide-react';
import { useMail } from '../context/MailContext';

export const ToastHost: React.FC = () => {
    const { toasts, dismissToast } = useMail();

    return (
        <div style={{
            position: 'fixed',
            // Above the dock; while Settings is open, just above its bottom edge (SettingsDialog sets it)
            bottom: 'var(--notice-bottom, 120px)',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            zIndex: 400,
            pointerEvents: 'none'
        }}>
            <AnimatePresence>
                {toasts.map(toast => (
                    <motion.div
                        key={toast.id}
                        layout
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={tween(DURATION.mid)} // notices: 200ms (utils/motion.ts)
                        role={toast.tone === 'error' ? 'alert' : 'status'}
                        style={{
                            backgroundColor: toast.tone === 'error' ? 'var(--toast-error-bg)' : 'var(--toast-bg)',
                            color: 'var(--toast-text)',
                            border: 'var(--toast-border)',
                            padding: '12px 24px',
                            borderRadius: 'var(--radius-pill)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-md)',
                            boxShadow: 'var(--shadow-lg)',
                            maxWidth: 'min(640px, 90vw)',
                            pointerEvents: 'auto'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            {toast.tone === 'error'
                                ? <AlertCircle size={16} color="var(--toast-error-icon)" style={{ flexShrink: 0 }} />
                                : <CheckCircle size={16} color="var(--toast-success-icon)" style={{ flexShrink: 0 }} />}
                            <span style={{ fontSize: 'var(--font-size-sm)' }}>{toast.message}</span>
                        </div>
                        {toast.actions?.map(action => (
                            <button
                                key={action.label}
                                onClick={() => {
                                    dismissToast(toast.id);
                                    action.onClick();
                                }}
                                style={{
                                    color: 'var(--toast-text)',
                                    fontWeight: 'var(--weight-semibold)',
                                    fontSize: 'var(--font-size-sm)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    backgroundColor: 'var(--toast-action-bg)',
                                    borderRadius: 'max(4px, calc(var(--radius-pill) - 12px))',
                                    whiteSpace: 'nowrap',
                                    border: 'var(--toast-action-border)',
                                    cursor: 'pointer'
                                }}
                            >
                                {action.label}
                            </button>
                        ))}
                        {toast.durationMs === null && (
                            <button
                                onClick={() => dismissToast(toast.id)}
                                title="Dismiss"
                                style={{ color: 'var(--toast-dismiss)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '2px' }}
                            >
                                <X size={16} />
                            </button>
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
};
