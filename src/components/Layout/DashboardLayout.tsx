import React from 'react';
import { TopNavbar } from './TopNavbar';
import { BucketsDock } from '../Buckets/BucketsDock';

interface DashboardLayoutProps {
    children: React.ReactNode;
    activeBucket: string;
    onBucketSelect: (id: string) => void;
    onSearchClick: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, activeBucket, onBucketSelect, onSearchClick }) => {
    return (
        <div className="dashboard-layout" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            backgroundColor: 'var(--color-bg)',
            overflow: 'hidden'
        }}>
            {/* Tier 1: Top Navbar */}
            <TopNavbar onSearchClick={onSearchClick} onNavigate={onBucketSelect} />

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

            {/* Tier 3: Floating Dock */}
            <BucketsDock activeBucket={activeBucket} onSelect={onBucketSelect} />
        </div>
    );
};
