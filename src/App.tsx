import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/Layout/DashboardLayout';
import { TriageInbox } from './components/Inbox/TriageInbox';
import { BucketGallery } from './components/Views/BucketGallery';
import { ArchiveView } from './components/Views/ArchiveView';
import { EmailOverlay } from './components/Views/EmailOverlay';
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
    const [isConfigured, setIsConfigured] = useState<boolean | null>(null); // null = loading
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const { buckets, refreshData } = useMail();

    // Check if app is configured and authenticated on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                // Check setup status
                const setupRes = await fetch('/api/setup/status');
                const setupData = await setupRes.json();
                setIsConfigured(setupData.configured);

                if (setupData.configured) {
                    // Check auth status
                    const authRes = await fetch('/api/auth/check');
                    const authData = await authRes.json();

                    // If auth is disabled, consider authenticated
                    if (!authData.enabled) {
                        setIsAuthenticated(true);
                    } else {
                        setIsAuthenticated(authData.authenticated);
                    }

                    // Check if onboarding has been seen
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

    // Show loading state while checking
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

    // Show setup wizard if not configured
    if (!isConfigured) {
        return <SetupWizard onComplete={async () => {
            setIsConfigured(true);
            setIsAuthenticated(true); // Assume authenticated after setup
            // Force a data refresh now that we have config
            await refreshData();
            // Show onboarding after fresh setup
            setShowOnboarding(true);
        }} />;
    }

    // Show login if configured but not authenticated
    if (!isAuthenticated) {
        return <Login onLogin={() => {
            setIsAuthenticated(true);
            refreshData();
        }} />;
    }

    const activeBucket = buckets.find(b => b.id === activeBucketId) || buckets[0];

    return (
        <>
            <DashboardLayout
                activeBucket={activeBucketId}
                onBucketSelect={setActiveBucketId}
                onSearchClick={() => setIsSearchOpen(true)}
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
            <EmailOverlay email={selectedEmail} onClose={() => setSelectedEmail(null)} />
            <SearchOverlay
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelectEmail={setSelectedEmail}
            />
        </>
    );
}

export default App;
