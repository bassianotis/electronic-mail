import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { DashboardLayout } from './components/Layout/DashboardLayout';
import { TriageInbox } from './components/Inbox/TriageInbox';
import { BucketGallery } from './components/Views/BucketGallery';
import { ArchiveView } from './components/Views/ArchiveView';
import { LibraryCardView } from './components/Views/LibraryCardView';
import { SearchOverlay } from './components/Views/SearchOverlay';
import { SetupWizard } from './components/Setup/SetupWizard';
import { OnboardingModal } from './components/Modals/OnboardingModal';
import { Composer } from './components/Compose/Composer';
import { CornerWindow } from './components/Compose/CornerWindow';
import { ToastHost } from './components/ToastHost';
import { ServerBanner } from './components/ServerBanner';
import { SignedOutDialog } from './components/SignedOutDialog';
import { setFamilyFrom, signInAgain, signedOutKind, SIGN_IN_REASON } from './api/family';
import { setOpenThread } from './utils/currentView';
import { Login } from './components/Auth/Login';
import { StartFrame } from './components/Loading/StartFrame';
import { FLOATING_WIDTH } from './utils/layout';
import { AnimationProvider } from './context/AnimationContext';
import { DragPillLayer } from './components/DragPill';
// The design playground (?playground): loaded, with its font, only when the address asks for it
const Playground = lazy(() => import('./components/Playground'));
const PLAYGROUND = new URLSearchParams(window.location.search).has('playground');
import { DragDropProvider } from './context/DragDropContext';
import { useMail, MailProvider } from './context/MailContext';
import { ComposerProvider, OPEN_CONVERSATION_EVENT, useComposer } from './context/ComposerContext';
import { type Email } from './store/mailStore';
import { api, errorText, paths, AUTH_REQUIRED_EVENT, SESSION_RESTORED_EVENT } from './api/client';
import type { AuthStatus, DraftContent, DraftSummary, ThreadDetail } from './api/types';
import { cardFromThread, messageFromThread } from './utils/emailMapper';

type Gate = 'loading' | 'unreachable' | 'first-run' | 'login' | 'ready';

/**
 * Login first; the mail screens only exist for a signed-in user. Until the engine says which, the
 * page is blank, and after 250ms the start frame (never the login form by mistake).
 */
function App() {
    const [gate, setGate] = useState<Gate>('loading');
    // The session ended while the app was open: log in again on top of it, so whatever was open
    // (a conversation, a half-written reply) is still there afterwards.
    const [sessionEnded, setSessionEnded] = useState(false);
    // With the shared Bassapps sign-in, signing in is its own page: a dialog says so (and why)
    const [signedOut, setSignedOut] = useState<{ reason: string | null } | null>(null);
    const sharedSignIn = useRef(false);
    const gateRef = useRef(gate);
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        gateRef.current = gate;
    }, [gate]);

    const checkStatus = async () => {
        try {
            const status = await api.get<AuthStatus>('/auth/status');
            if (status.mode === 'door') {
                sharedSignIn.current = true;
                // Not signed in: straight to the sign-in page, coming back here (its banner says why)
                if (!status.authenticated) {
                    const why = status.reason && status.reason !== 'signed-out' && status.reason !== 'unknown' ? SIGN_IN_REASON[signedOutKind(status.reason)] : null;
                    signInAgain(window.location.pathname + window.location.search, why);
                    return;
                }
                setFamilyFrom(status);
                setGate('ready');
                return;
            }
            setGate(status.enabled && !status.configured ? 'first-run' : status.authenticated ? 'ready' : 'login');
        } catch (error) {
            console.error('Failed to check status:', error);
            setGate('unreachable');
        }
    };

    useEffect(() => {
        void checkStatus();
        // Any "not logged in" answer, from any call: the session ended (expired, or signed out elsewhere).
        const onAuthRequired = (e: Event) => {
            if (gateRef.current !== 'ready') return;
            if (sharedSignIn.current) setSignedOut(s => s ?? { reason: (e as CustomEvent<{ reason?: string | null }>).detail?.reason ?? null });
            else setSessionEnded(true);
        };
        window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    }, []);

    if (gate === 'loading') {
        return <StartFrame />;
    }

    if (gate === 'unreachable') {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                height: '100vh',
                fontSize: 'var(--font-size-lg)',
                color: 'var(--status-text)'
            }}>
                <span>The mail app's server isn't answering.</span>
                <button onClick={() => { setGate('loading'); void checkStatus(); }} style={{ fontSize: 'var(--font-size-sm)', padding: '8px 16px', borderRadius: 'var(--radius-control)', border: '1px solid var(--pill-border)', background: 'var(--surface-card)', cursor: 'pointer' }}>
                    Try again
                </button>
            </div>
        );
    }

    if (gate === 'first-run') {
        return <SetupWizard onComplete={() => {
            setGate('ready');
            setShowOnboarding(true);
        }} />;
    }

    if (gate === 'login') {
        return <Login onLogin={() => setGate('ready')} />;
    }

    return (
        <>
            <div inert={sessionEnded || !!signedOut} aria-hidden={sessionEnded || !!signedOut || undefined}>
                <AnimationProvider>
                    <MailProvider>
                        <ComposerProvider>
                            <DragDropProvider>
                                <AppContent showOnboarding={showOnboarding} setShowOnboarding={setShowOnboarding} />
                            </DragDropProvider>
                        </ComposerProvider>
                    </MailProvider>
                </AnimationProvider>
            </div>
            {signedOut && <SignedOutDialog reason={signedOut.reason} />}
            {sessionEnded && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
                    <Login sessionEnded onLogin={() => {
                        setSessionEnded(false);
                        window.dispatchEvent(new Event(SESSION_RESTORED_EVENT));
                    }} />
                </div>
            )}
        </>
    );
}

function AppContent({ showOnboarding, setShowOnboarding }: { showOnboarding: boolean; setShowOnboarding: (v: boolean) => void }) {
    const [activeBucketId, setActiveBucketId] = useState('inbox');
    // The open conversation, and a reply draft to open in it (one picked in Up next)
    const [selection, setSelection] = useState<{ email: Email; draft?: string } | null>(null);
    const selectedEmail = selection?.email ?? null;
    // "Sign in again" comes back to the conversation that's open
    useEffect(() => { setOpenThread(selectedEmail?.threadId ?? null); }, [selectedEmail]);
    const setSelectedEmail = useCallback((email: Email | null) => setSelection(email ? { email } : null), []);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const { draft: composing, openNew, openSaved, close: closeDraft, update: updateDraft } = useComposer();
    // A conversation to open once its account is the active one (Back from the corner, across accounts)
    const [pendingConversation, setPendingConversation] = useState<{ accountId: string; threadId: string } | null>(null);
    const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(() => new URLSearchParams(window.location.search).get('thread'));

    const { buckets, accounts, accountsLoaded, accountsFailing, isAddingAccount, setIsAddingAccount, fetchAccounts, activeAccountId, setActiveAccountId, viewOf, showToast } = useMail();

    // Reset to inbox whenever the active email account changes
    useEffect(() => {
        setActiveBucketId('inbox');
        setSelectedEmail(null);
    }, [activeAccountId, setSelectedEmail]);

    // A bucket that was deleted or renamed is no longer there to show
    useEffect(() => {
        if (activeBucketId !== 'inbox' && activeBucketId !== 'archive' && buckets.length && !buckets.some(b => b.id === activeBucketId)) {
            setActiveBucketId('inbox');
        }
    }, [buckets, activeBucketId]);

    // First visit: the welcome tour
    useEffect(() => {
        try {
            if (!localStorage.getItem('mail_onboarding_seen')) setShowOnboarding(true);
        } catch { /* fine */ }
    }, [setShowOnboarding]);

    // Listen for navigation events from toast CTAs
    useEffect(() => {
        const handleNavigateToBucket = (e: Event) => {
            const bucketId = (e as CustomEvent).detail?.bucketId;
            if (bucketId) setActiveBucketId(bucketId);
        };
        window.addEventListener('navigateToBucket', handleNavigateToBucket);
        return () => window.removeEventListener('navigateToBucket', handleNavigateToBucket);
    }, []);

    // A conversation asked for by the composer (Back from the corner, Open on a "Draft saved"
    // notice): its reply goes back under it. In another account, that account's tab first, then the
    // conversation, like a thread link. If it's gone, the draft shows centred instead.
    useEffect(() => {
        const handleOpenConversation = (e: Event) => {
            const wanted = (e as CustomEvent<{ accountId: string; threadId: string }>).detail;
            if (wanted.accountId === activeAccountId && selectedEmail?.threadId === wanted.threadId) return; // open already
            setPendingConversation(wanted);
            if (wanted.accountId !== activeAccountId) setActiveAccountId(wanted.accountId);
        };
        window.addEventListener(OPEN_CONVERSATION_EVENT, handleOpenConversation);
        return () => window.removeEventListener(OPEN_CONVERSATION_EVENT, handleOpenConversation);
    }, [activeAccountId, selectedEmail, setActiveAccountId]);

    useEffect(() => {
        if (!pendingConversation || pendingConversation.accountId !== activeAccountId) return;
        const { accountId, threadId } = pendingConversation;
        api.get<ThreadDetail>(paths.thread(accountId, threadId))
            .then(detail => setSelectedEmail(cardFromThread(detail.thread)))
            .catch(() => updateDraft(d => ({ original: d.original && { ...d.original, threadId: null } }), false))
            .finally(() => setPendingConversation(null));
    }, [pendingConversation, activeAccountId, setSelectedEmail, updateDraft]);

    // Handle thread deep link: ?thread=<threadId>
    useEffect(() => {
        if (!pendingDeepLink || !activeAccountId) return;
        const threadId = pendingDeepLink;
        setPendingDeepLink(null);
        const url = new URL(window.location.href);
        url.searchParams.delete('thread');
        window.history.replaceState({}, '', url.pathname + url.search);
        api.get<ThreadDetail>(paths.thread(activeAccountId, threadId))
            .then(detail => {
                setActiveBucketId(viewOf(detail.thread.location));
                setSelectedEmail(cardFromThread(detail.thread));
            })
            .catch(err => console.error('[DeepLink] Thread not found:', threadId, err));
    }, [pendingDeepLink, activeAccountId, viewOf, setSelectedEmail]);

    const handleOnboardingClose = () => {
        setShowOnboarding(false);
        try { localStorage.setItem('mail_onboarding_seen', 'true'); } catch { /* fine */ }
    };

    const handleNewCompose = () => {
        setSelectedEmail(null);
        void openNew();
    };

    // A draft picked in Up next opens where it was left: a reply docked in its conversation; a new
    // message, a forward or a reply whose conversation isn't here, centred.
    const handleOpenDraft = (draft: DraftSummary) => {
        if (!activeAccountId) return;
        const failed = (err: unknown) => showToast({ message: `Couldn't open the draft: ${errorText(err)}`, tone: 'error' });
        if (draft.threadId) {
            api.get<ThreadDetail>(paths.thread(activeAccountId, draft.threadId))
                .then(detail => setSelection({ email: cardFromThread(detail.thread), draft: draft.msgKey }))
                .catch(failed);
        } else {
            api.get<{ draft: DraftContent }>(paths.draft(activeAccountId, draft.msgKey))
                .then(async ({ draft: content }) => {
                    setSelectedEmail(null);
                    // A reply written from this account to mail in the other one: back in that
                    // conversation (its tab first), else centred.
                    const original = content.originalAccount && accounts.some(a => a.id === content.originalAccount) ? content.originalAccount : null;
                    const answered = content.inReplyTo?.replace(/^<|>$/g, '');
                    if (original && answered) {
                        const detail = await api.get<ThreadDetail>(paths.thread(original, answered)).catch(() => null);
                        const message = detail?.messages.find(m => m.msgKey === answered);
                        if (detail) {
                            await openSaved({ accountId: activeAccountId, originalAccountId: original, content, threadId: detail.thread.threadId,
                                email: message ? messageFromThread(message, detail.thread) : null });
                            window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { accountId: original, threadId: detail.thread.threadId } }));
                            return;
                        }
                    }
                    return openSaved({ accountId: activeAccountId, content, threadId: null });
                })
                .catch(failed);
        }
    };

    // The start frame until the engine has answered with the account list: "no accounts yet" (the
    // setup screen) is only ever shown for a list that really is empty, never for one that failed.
    if (!accountsLoaded) {
        return accountsFailing ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--color-bg)', fontSize: 'var(--font-size-lg)', color: 'var(--status-text)' }}>
                The mail app's server isn't answering. Trying again…
            </div>
        ) : <StartFrame />;
    }

    if (isAddingAccount || accounts.length === 0) {
        return <SetupWizard
            isNewAccount={true}
            onCancel={accounts.length ? () => setIsAddingAccount(false) : undefined}
            onComplete={() => {
                setIsAddingAccount(false);
                void fetchAccounts();
            }}
        />;
    }

    const activeBucket = buckets.find(b => b.id === activeBucketId);

    return (
        <>
            <DashboardLayout
                activeBucket={activeBucketId}
                onBucketSelect={setActiveBucketId}
                onSearchClick={() => setIsSearchOpen(true)}
                onComposeClick={handleNewCompose}
            >
                {activeBucketId === 'archive' ? (
                    <ArchiveView onSelectEmail={setSelectedEmail} />
                ) : activeBucketId === 'inbox' || !activeBucket ? (
                    <TriageInbox onSelectEmail={setSelectedEmail} onOpenDraft={handleOpenDraft} />
                ) : (
                    <BucketGallery bucket={activeBucket} onSelectEmail={setSelectedEmail} />
                )}
            </DashboardLayout>

            <OnboardingModal
                isOpen={showOnboarding}
                onClose={handleOnboardingClose}
            />

            {/* The conversation, wherever it was opened from */}
            {selectedEmail && (
                <LibraryCardView
                    key={selectedEmail.threadId}
                    email={selectedEmail}
                    openDraft={selection?.draft}
                    onClose={() => setSelectedEmail(null)}
                />
            )}

            {/* A new message (or a draft without its conversation): the composer centred on its own */}
            {composing && composing.place === 'docked' && !composing.original?.threadId && (
                <div style={{ position: 'fixed', inset: 0, top: 'var(--server-banner)', zIndex: 200 }}>
                    <div
                        onClick={() => void closeDraft()}
                        style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--overlay-scrim)', backdropFilter: 'blur(var(--blur-overlay))' }}
                    />
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 24px' }}>
                        <div style={{
                            pointerEvents: 'auto',
                            // Sized to the window: up to 1000px, 24px clear of each side, centred on it
                            width: FLOATING_WIDTH,
                            minWidth: 0,
                            height: '780px',
                            maxHeight: '100%',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'var(--shadow-panel)',
                            border: '1px solid var(--border-strong)',
                            overflow: 'hidden'
                        }}>
                            <Composer />
                        </div>
                    </div>
                </div>
            )}

            {/* The draft in the corner, above everything but the notices */}
            <CornerWindow />

            <SearchOverlay
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelectEmail={setSelectedEmail}
            />

            <ServerBanner />
            <ToastHost />
            <DragPillLayer />
            {PLAYGROUND && <Suspense fallback={null}><Playground /></Suspense>}
        </>
    );
}

export default App;
