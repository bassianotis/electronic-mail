/**
 * MailContext
 * Composes useEmails, useBuckets, and useRules hooks into a unified context
 */
import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import { type Email, type Bucket, type Rule } from '../store/mailStore';
import { useEmails } from '../hooks/useEmails';
import { useBuckets } from '../hooks/useBuckets';
import { useRules } from '../hooks/useRules';

interface MailContextType {
    emails: Email[];
    buckets: Bucket[];
    rules: Rule[];
    isLoading: boolean;
    isSyncing: boolean;
    archiveEmail: (id: string, bucketId?: string) => void;
    unarchiveEmail: (email: Email, targetLocation: string) => void;
    bucketEmail: (id: string, bucketId: string) => void;
    updateEmail: (id: string, updates: Partial<Email>) => void;
    loadEmailBody: (id: string, uid?: string) => Promise<any>;
    markAsRead: (id: string, uid?: string) => void;
    addBucket: (label: string, color: string) => Promise<void>;
    updateBucket: (id: string, updates: Partial<Bucket>) => Promise<void>;
    deleteBucket: (id: string) => Promise<void>;
    reorderBuckets: (bucketIds: string[]) => Promise<void>;
    addRule: (senderPattern: string, bucketId: string) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
    setCurrentView: (view: 'inbox' | 'bucket' | 'archive') => void;
    currentView: 'inbox' | 'bucket' | 'archive';
    refreshData: () => Promise<void>;
}

const MailContext = createContext<MailContextType | undefined>(undefined);

export const MailProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentView, setCurrentView] = useState<'inbox' | 'bucket' | 'archive'>('inbox');

    // Compose hooks
    const emailsHook = useEmails();
    const bucketsHook = useBuckets();
    const rulesHook = useRules();

    // Initial data fetch
    const fetchData = async () => {
        emailsHook.setIsLoading(true);
        emailsHook.setEmails([]);
        bucketsHook.setBuckets([]);
        rulesHook.setRules([]);

        try {
            // 1. Fetch inbox emails (cached)
            await emailsHook.fetchInboxEmails();

            // 2. Fetch buckets
            await bucketsHook.fetchBuckets();

            // 3. Fetch rules
            await rulesHook.fetchRules();

            emailsHook.setIsLoading(false);

            // NOTE: Background sync disabled to reduce IMAP load.
            // The 5-minute sync worker on the backend handles syncing.
            // emailsHook.triggerSync(emailsHook.fetchInboxEmails);

        } catch (error) {
            console.error('Error initializing mail context:', error);
            emailsHook.setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Background preview loading
    useEffect(() => {
        let isCancelled = false;

        const loadPreviewsInBackground = async () => {
            const emailsNeedingPreviews = emailsHook.emails.filter(
                email => !email.preview && email.body === '<p>Loading body...</p>'
            );

            if (emailsNeedingPreviews.length === 0) return;

            for (const email of emailsNeedingPreviews.slice(0, 3)) {
                if (isCancelled) return;
                try {
                    await emailsHook.loadEmailBody(email.id, email.uid);
                } catch (err) {
                    console.error('Error loading preview:', err);
                }
            }
        };

        if (!emailsHook.isLoading && emailsHook.emails.length > 0) {
            loadPreviewsInBackground();
        }

        return () => { isCancelled = true; };
    }, [emailsHook.emails, emailsHook.isLoading, emailsHook.loadEmailBody]);

    // Periodic sync for inbox view - INCREASED to 10 minutes to reduce IMAP load
    // The backend sync worker runs every 5 minutes, so this is a fallback
    useEffect(() => {
        if (currentView !== 'inbox') return;

        const interval = setInterval(() => {
            emailsHook.triggerSync(emailsHook.fetchInboxEmails);
        }, 10 * 60 * 1000); // 10 minutes instead of 3

        return () => clearInterval(interval);
    }, [currentView, emailsHook]);

    // Wrapper functions that pass dependencies
    const archiveEmail = (id: string, bucketId?: string) => emailsHook.archiveEmail(id, bucketsHook.refetchBuckets, bucketId);

    const unarchiveEmail = (email: Email, targetLocation: string) =>
        emailsHook.unarchiveEmail(email, targetLocation, bucketsHook.refetchBuckets, emailsHook.fetchInboxEmails);

    const bucketEmail = (id: string, bucketId: string) =>
        emailsHook.bucketEmail(id, bucketId, bucketsHook.refetchBuckets);

    return (
        <MailContext.Provider value={{
            emails: emailsHook.emails,
            buckets: bucketsHook.buckets,
            rules: rulesHook.rules,
            isLoading: emailsHook.isLoading,
            isSyncing: emailsHook.isSyncing,
            archiveEmail,
            unarchiveEmail,
            bucketEmail,
            updateEmail: emailsHook.updateEmail,
            loadEmailBody: emailsHook.loadEmailBody,
            markAsRead: emailsHook.markAsRead,
            addBucket: bucketsHook.addBucket,
            updateBucket: bucketsHook.updateBucket,
            deleteBucket: bucketsHook.deleteBucket,
            reorderBuckets: bucketsHook.reorderBuckets,
            addRule: rulesHook.addRule,
            deleteRule: rulesHook.deleteRule,
            refreshData: fetchData,
            setCurrentView,
            currentView
        }}>
            {children}
        </MailContext.Provider>
    );
}

export const useMail = () => {
    const context = React.useContext(MailContext);
    if (!context) {
        throw new Error('useMail must be used within a MailProvider');
    }
    return context;
};
