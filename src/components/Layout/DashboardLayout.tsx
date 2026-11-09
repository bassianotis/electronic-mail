import React from 'react';
import { TopNavbar } from './TopNavbar';
import { AccountRail } from './AccountRail';
import { BucketsDock } from '../Buckets/BucketsDock';

interface DashboardLayoutProps {
    children: React.ReactNode;
    activeBucket: string;
    onBucketSelect: (id: string) => void;
    onSearchClick: () => void;
    onComposeClick?: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, activeBucket, onBucketSelect, onSearchClick, onComposeClick }) => {
    return (
        <div className="dashboard-layout" style={{
            display: 'flex',
            height: '100vh',
            backgroundColor: 'var(--color-bg)',
            overflow: 'hidden'
        }}>
            {/* The accounts, as tabs on the window's edge */}
            <AccountRail />

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {/* The top bar and the page slide down under the "Can't reach the server" band while it
                    shows (the dock, fixed to the window, stays where it is) */}
                <div className="below-server-banner" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {/* Tier 1: Top Navbar */}
                    <TopNavbar onSearchClick={onSearchClick} onNavigate={onBucketSelect} onComposeClick={onComposeClick} />

                    {/* Tier 2: Main Content Area */}
                    <main style={{
                        flex: 1,
                        overflowY: 'auto',
                        position: 'relative',
                        padding: '0 var(--space-lg) var(--space-3xl)',
                    }}>
                        <div className="container" style={{ height: '100%' }}>
                            {children}
                        </div>
                    </main>
                </div>

                {/* Tier 3: Floating Dock */}
                <BucketsDock activeBucket={activeBucket} onSelect={onBucketSelect} />
            </div>
        </div>
    );
};
