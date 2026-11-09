/**
 * Signed out while using Mail, with the shared Bassapps sign-in:
 * a dialog over everything, on a darker scrim, and the page behind stays as it was. It can't be
 * dismissed, only acted on: "Sign in again" goes to the sign-in page and comes back to this exact
 * view. Anything being written was kept on this computer first (ComposerContext) and is offered back.
 * The engine says why, and the words follow it: if another computer did it, say so and say what.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LogOut } from 'lucide-react';
import { signInAgain, signedOutKind, SIGN_IN_REASON, type SignedOutKind } from '../api/family';
import { returnPath } from '../utils/currentView';

const KEPT = "Anything you were writing stays on this computer until you're back.";

const COPY: Record<SignedOutKind, { title: string; body: string; caption?: string }> = {
    ended: {
        title: 'Your session ended',
        body: `Sign in again to pick up right here. ${KEPT}`,
    },
    elsewhere: {
        title: 'You were signed out from another computer',
        body: `Sign in again to keep using Mail here. ${KEPT}`,
        caption: "If that wasn't you, change your passphrase after signing in",
    },
    passphrase: {
        title: 'Your passphrase was changed',
        body: `It was changed on another computer, which signs out every other one. Sign in with the new passphrase to keep using Mail here. ${KEPT}`,
        caption: "If that wasn't you, reset it on the server",
    },
};

export const SignedOutDialog: React.FC<{ reason: string | null }> = ({ reason }) => {
    const kind = signedOutKind(reason);
    const copy = COPY[kind];
    const button = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        button.current?.focus();
        // Escape does nothing here, and Tab stays on the one thing to do
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                button.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    return createPortal(
        <div className="signed-out-scrim">
            <div className="signed-out-dialog" role="alertdialog" aria-modal="true" aria-labelledby="signed-out-title" aria-describedby="signed-out-body">
                <LogOut size={20} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
                <h2 id="signed-out-title">{copy.title}</h2>
                <p id="signed-out-body">{copy.body}</p>
                <button ref={button} type="button" className="signed-out-button" onClick={() => signInAgain(returnPath(), SIGN_IN_REASON[kind])}>
                    Sign in again
                </button>
                {copy.caption && <span className="signed-out-caption">{copy.caption}</span>}
            </div>
        </div>,
        document.body,
    );
};
