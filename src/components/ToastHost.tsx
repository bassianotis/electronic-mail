/**
 * The notices at the bottom of the screen ("Filed to Reads · Undo"): the shared Notice, one at a
 * time (rule N1: the newest replaces the last; MailContext keeps one waiting on a decision underneath,
 * and it comes back). The area is a polite live region, there before anything is said (K8).
 */
import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMail } from '../context/MailContext';
import { Notice } from '../ui/Notice';

export const ToastHost: React.FC = () => {
    const { toasts, dismissToast } = useMail();
    const current = toasts[toasts.length - 1];
    return (
        <div data-layer="notice" className="ba-notices" role="status" aria-live="polite">
            <AnimatePresence mode="wait">
                {current && (
                    <Notice
                        key={current.id}
                        message={current.message}
                        tone={current.tone}
                        actions={current.actions}
                        durationMs={current.durationMs}
                        onTimeout={() => dismissToast(current.id)}
                        onClose={action => {
                            dismissToast(current.id, action !== null);
                            if (action !== null) current.actions?.[action]?.onClick();
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};
