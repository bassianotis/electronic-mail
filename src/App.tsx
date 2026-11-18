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
import { Button } from './ui/Button';
// The design playground (?playground): loaded, with its font, only when the address asks for it
const Playground = lazy(() => import('./components/Playground'));
const PLAYGROUND = new URLSearchParams(window.location.search).has('playground');
// The design trials (?trials, docs/design: the v2 font candidates): loaded, with the fonts, only when
// asked for, left open, or a trial font is still chosen in this browser
const DesignTrials = lazy(() => import('./trials/DesignTrials'));
const TRIALS = trialsWanted();
import { DragDropProvider } from './context/DragDropContext';
import { useMail, MailProvider } from './context/MailContext';
import { ComposerProvider, OPEN_CONVERSATION_EVENT, useComposer } from './context/ComposerContext';
import { type Email } from './store/mailStore';
import type { ListKey } from './hooks/conversationLists';
import { api, couldnt, paths, AUTH_REQUIRED_EVENT, SESSION_RESTORED_EVENT } from './api/client';
import type { AuthStatus, DraftContent, DraftSummary, ThreadDetail } from './api/types';
import { cardFromThread, messageFromThread } from './utils/emailMapper';
import { trialsWanted } from './trials/trialsState';
import { KEEP_OVER_VIEW, useModal, Z } from './utils/layers';
import { Dialog } from './ui/Dialog';

type Gate = 'loading' | 'unreachable' | 'first-run' | 'login' | 'ready';

/**
 * Login first; the mail screens only exist for a signed-in user. Until the engine says which, the
 * page is blank, and after 300ms the start frame (never the login form by mistake).
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
                gap: 'var(--space-3)',
                height: '100vh',
                fontSize: 'var(--size-title)',
                color: 'var(--text-3)'
            }}>
                <span>The mail app's server isn't answering.</span>
                <Button onClick={() => { setGate('loading'); void checkStatus(); }}>Try again</Button>
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
                <MailProvider>
                    <ComposerProvider>
                        <DragDropProvider>
                            <AppContent showOnboarding={showOnboarding} setShowOnboarding={setShowOnboarding} />
                        </DragDropProvider>
                    </ComposerProvider>
                </MailProvider>
            </div>
            {signedOut && <SignedOutDialog reason={signedOut.reason} />}
            {sessionEnded && (
                <div data-layer="critical" style={{ position: 'fixed', inset: 0, zIndex: Z.critical.sessionEnded }}>
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
    // The open conversation, a draft to open in it (one picked in Up next), the list it was opened
    // from (previous / next follow it), and whether it replaced another one (then no entrance)
    const [selection, setSelection] = useState<{ email: Email; draft?: string; list?: ListKey; switched?: boolean } | null>(null);
    const selectedEmail = selection?.email ?? null;
    // "Sign in again" comes back to the conversation that's open
    useEffect(() => { setOpenThread(selectedEmail?.threadId ?? null); }, [selectedEmail]);
    const setSelectedEmail = useCallback((email: Email | null, list?: ListKey) => setSelection(email ? { email, list } : null), []);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const { draft: composing, openNew, openSaved, close: closeDraft, update: updateDraft } = useComposer();
    // A conversation to open once its account is the active one (Back from the corner, across accounts)
    const [pendingConversation, setPendingConversation] = useState<{ accountId: string; threadId: string } | null>(null);
    const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(() => new URLSearchParams(window.location.search).get('thread'));

    const { buckets, accounts, accountsLoaded, accountsFailing, fetchAccounts, activeAccountId, setActiveAccountId, viewOf, showToast } = useMail();

    // An open thread and a new message are modal (rule L3): the focus moves in, Tab stays inside (and
    // on the notices; a thread also leaves the corner window usable), the page behind is inert, and
    // closing goes back to whatever opened it. A thread that has moved on returns to its own card.
    const viewLayer = useRef<HTMLDivElement>(null);
    const lastThread = useRef<string | null>(null);
    useEffect(() => { if (selectedEmail) lastThread.current = selectedEmail.threadId; }, [selectedEmail]);
    useModal(viewLayer, !!selectedEmail, {
        keep: KEEP_OVER_VIEW,
        initial: () => viewLayer.current,
        fallback: () => (lastThread.current ? document.querySelector<HTMLElement>(`a[data-thread-link][href="${CSS.escape(`?thread=${encodeURIComponent(lastThread.current)}`)}"]`) : null),
    });
    const centred = !!composing && composing.place === 'docked' && !composing.original?.threadId;

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
        const failed = (err: unknown) => showToast({ message: couldnt('open the draft', err), tone: 'error' });
        if (draft.threadId) {
            api.get<ThreadDetail>(paths.thread(activeAccountId, draft.threadId))
                .then(detail => setSelection({ email: cardFromThread(detail.thread), draft: draft.msgKey }))
                .catch(failed);
        } else {
            api.get<{ draft: DraftContent }>(paths.draft(activeAccountId, draft.msgKey))
                .then(async ({ draft: content }) => {
                    // A forward goes back to the conversation of the message it forwards, if it's here
                    if (content.forwardOf) {
                        const detail = await api.get<ThreadDetail>(paths.thread(activeAccountId, content.forwardOf)).catch(() => null);
                        if (detail) {
                            setSelection({ email: cardFromThread(detail.thread), draft: draft.msgKey });
                            return;
                        }
                    }
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-page)', fontSize: 'var(--size-title)', color: 'var(--text-3)' }}>
                The mail app's server isn't answering. Trying again…
            </div>
        ) : <StartFrame />;
    }

    // The very first account only: later ones are added in Settings → Accounts (owner, 2026-11-11)
    if (accounts.length === 0) {
        return <SetupWizard isNewAccount={true} onComplete={() => void fetchAccounts()} />;
    }

    const activeBucket = buckets.find(b => b.id === activeBucketId);

    return (
        <>
            <DashboardLayout
                activeBucket={activeBucketId}
                onBucketSelect={setActiveBucketId}
                onSearchClick={() => { setSelectedEmail(null); setIsSearchOpen(true); }} // views replace each other (rule L6)
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
            <div ref={viewLayer} data-layer="view">
                {selectedEmail && (
                    <LibraryCardView
                        key={selectedEmail.threadId}
                        email={selectedEmail}
                        openDraft={selection?.draft}
                        list={selection?.list}
                        onOpen={(next, list) => setSelection(prev => ({ email: next, list, switched: !!prev }))}
                        switched={selection?.switched}
                        onClose={() => setSelectedEmail(null)}
                    />
                )}
            </div>

            {/* A new message (or a draft without its conversation): the composer centred on its own, in the
                shared Dialog at the reading width (board P5-fields-dialogs-end-state, row 4). Esc and a
                click outside close it and keep the draft (rule L4; the owner, 2026-11-11) */}
            {centred && (
                <Dialog size="reading" bare still label="New message" title="New message" onClose={() => void closeDraft()}
                    layerStyle={{ top: 'var(--server-banner)' }} style={{ height: '780px', overflow: 'hidden' }}>
                    <Composer />
                </Dialog>
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
            {PLAYGROUND && <Suspense fallback={null}><Playground /></Suspense>}
            {TRIALS && <Suspense fallback={null}><DesignTrials /></Suspense>}
        </>
    );
}

export default App;
