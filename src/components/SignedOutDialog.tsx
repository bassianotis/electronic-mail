/**
 * Signed out while using Mail, with the shared Bassapps sign-in:
 * the shared Dialog's alert, over everything, and the page behind stays as it was. It can't be
 * dismissed, only acted on: "Sign in again" goes to the sign-in page and comes back to this exact
 * view. Anything being written was kept on this computer first (ComposerContext) and is offered back.
 * The engine says why, and the words follow it: if another computer did it, say so and say what.
 */
import React from 'react';
import { LogOut } from 'lucide-react';
import { signInAgain, signedOutKind, SIGN_IN_REASON, type SignedOutKind } from '../api/family';
import { returnPath } from '../utils/currentView';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

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
    // The shared Dialog's alert size (board P5-fields-dialogs-end-state, row 3): over everything, no
    // close, Esc does nothing, and the focus stays on the one thing to do
    return (
        <Dialog size="alert" still title={copy.title} titleId="signed-out-title"
            onClose={() => { /* it can't be dismissed, only acted on */ }}
            icon={<LogOut size={20} aria-hidden="true" />}
            actions={<Button kind="primary" size="lg" onClick={() => signInAgain(returnPath(), SIGN_IN_REASON[kind])}>Sign in again</Button>}
            after={copy.caption}>
            {copy.body}
        </Dialog>
    );
};
