import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/Layout/DashboardLayout';
import { TriageInbox } from './components/Inbox/TriageInbox';
import { BucketGallery } from './components/Views/BucketGallery';
import { ArchiveView } from './components/Views/ArchiveView';
import { EmailOverlay } from './components/Views/EmailOverlay';
import { ThreadCardView } from './components/Views/ThreadCardView';
import { SearchOverlay } from './components/Views/SearchOverlay';
import { SetupWizard } from './components/Setup/SetupWizard';
import { OnboardingModal } from './components/Modals/OnboardingModal';
import { AnimationProvider } from './context/AnimationContext';
import { DragDropProvider } from './context/DragDropContext';
import { useMail, MailProvider } from './context/MailContext';
import { type Email } from './store/mailStore';

function App() {
    return (
        <AnimationProvider>
            <MailProvider>
                <DragDropProvider>
                    <AppContent />
                </DragDropProvider>
            </MailProvider>
        </AnimationProvider>
    );
}

import { Login } from './components/Auth/Login';

function AppContent() {
    const [activeBucketId, setActiveBucketId] = useState('inbox');
    const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isNewCompose, setIsNewCompose] = useState(false);

    const { buckets, refreshData } = useMail();

    // Check if app is configured and authenticated on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const setupRes = await fetch('/api/setup/status');
                const setupData = await setupRes.json();
                setIsConfigured(setupData.configured);

                if (setupData.configured) {
                    const authRes = await fetch('/api/auth/check');
                    const authData = await authRes.json();

                    if (!authData.enabled) {
                        setIsAuthenticated(true);
                    } else {
                        setIsAuthenticated(authData.authenticated);
                    }

                    const hasSeenOnboarding = localStorage.getItem('mail_onboarding_seen');
                    if (!hasSeenOnboarding && (authData.authenticated || !authData.enabled)) {
                        setShowOnboarding(true);
                    }
                }
            } catch (error) {
                console.error('Failed to check status:', error);
                setIsConfigured(false);
            }
        };

        checkStatus();
    }, []);

    const handleOnboardingClose = () => {
        setShowOnboarding(false);
        localStorage.setItem('mail_onboarding_seen', 'true');
    };

    const handleNewCompose = () => {
        setSelectedEmail(null);
        setIsNewCompose(true);
    };

    if (isConfigured === null) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                fontSize: '18px',
                color: '#6b7280'
            }}>
                Loading...
            </div>
        );
    }

    if (!isConfigured) {
        return <SetupWizard onComplete={async () => {
            setIsConfigured(true);
            setIsAuthenticated(true);
            await refreshData();
            setShowOnboarding(true);
        }} />;
    }

    if (!isAuthenticated) {
        return <Login onLogin={() => {
            setIsAuthenticated(true);
            refreshData();
        }} />;
    }

    const activeBucket = buckets.find(b => b.id === activeBucketId) || buckets[0];

    // Determine if selected email is in a bucket (not inbox/archive)
    const isInBucket = selectedEmail?.bucketId && selectedEmail.bucketId !== 'inbox';

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
                ) : activeBucketId === 'inbox' ? (
                    <TriageInbox onSelectEmail={setSelectedEmail} />
                ) : (
                    <BucketGallery bucket={activeBucket} onSelectEmail={setSelectedEmail} />
                )}
            </DashboardLayout>

            <OnboardingModal
                isOpen={showOnboarding}
                onClose={handleOnboardingClose}
            />

            {/* Thread Card View - for bucket emails (shows all emails as cards) */}
            {selectedEmail && isInBucket && (
                <ThreadCardView
                    email={selectedEmail}
                    onClose={() => setSelectedEmail(null)}
                />
            )}

            {/* Email Overlay - for inbox/archive emails */}
            {selectedEmail && !isInBucket && (
                <EmailOverlay
                    email={selectedEmail}
                    onClose={() => setSelectedEmail(null)}
                />
            )}

            {/* New Compose Overlay - placeholder */}
            {isNewCompose && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 300
                }}>
                    <div style={{
                        backgroundColor: '#fff',
                        borderRadius: '12px',
                        padding: '24px',
                        textAlign: 'center'
                    }}>
                        <p>New Compose - Coming Soon</p>
                        <button
                            onClick={() => setIsNewCompose(false)}
                            style={{ marginTop: '16px', padding: '8px 16px' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            <SearchOverlay
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelectEmail={setSelectedEmail}
            />
        </>
    );
}

export default App;
