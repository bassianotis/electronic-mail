/**
 * MailContext
 * Composes useEmails, useBuckets, useRules, and useThreads hooks into a unified context
 */
import React, { createContext, useState, useEffect, type ReactNode } from 'react';
import { type Email, type Bucket, type Rule } from '../store/mailStore';
import type { ThreadGroup } from '../../shared/types/email';
import { useEmails } from '../hooks/useEmails';
import { useBuckets } from '../hooks/useBuckets';
import { useRules } from '../hooks/useRules';
import { useThreads } from '../hooks/useThreads';

interface MailContextType {
    emails: Email[];
    buckets: Bucket[];
    rules: Rule[];
    isLoading: boolean;
    isSyncing: boolean;
    archiveEmail: (id: string, bucketId?: string) => void;
    unarchiveEmail: (email: Email, targetLocation: string) => void;
    bucketEmail: (id: string, bucketId: string) => void;
    addEmailsToInbox: (emails: Email[]) => void;
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
    // Thread operations
    threads: ThreadGroup[];
    threadsLoading: boolean;
    fetchInboxThreads: () => Promise<ThreadGroup[]>;
    fetchBucketThreads: (bucketId: string) => Promise<ThreadGroup[]>;
    fetchArchiveThreads: () => Promise<ThreadGroup[]>;
    bucketThread: (threadId: string, bucketId: string) => Promise<boolean>;
    archiveThread: (threadId: string) => Promise<boolean>;
    unarchiveThread: (threadId: string, targetLocation: string, email?: Email) => Promise<boolean>;
    returnThreadToBucket: (threadId: string) => Promise<boolean>;
    unbucketThread: (threadId: string) => Promise<boolean>;
}

const MailContext = createContext<MailContextType | undefined>(undefined);

export const MailProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentView, setCurrentView] = useState<'inbox' | 'bucket' | 'archive'>('inbox');

    // Compose hooks
    const emailsHook = useEmails();
    const bucketsHook = useBuckets();
    const rulesHook = useRules();
    const threadsHook = useThreads();

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
            addEmailsToInbox: (emails: Email[]) => {
                emailsHook.setEmails(prev => {
                    const existingIds = new Set(prev.map(e => e.id));
                    const newEmails = emails.filter(e => !existingIds.has(e.id)).map(e => ({ ...e, bucketId: undefined }));
                    return [...newEmails, ...prev];
                });
            },
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
            currentView,
            // Thread operations
            threads: threadsHook.threads,
            threadsLoading: threadsHook.isLoading,
            fetchInboxThreads: threadsHook.fetchInboxThreads,
            fetchBucketThreads: threadsHook.fetchBucketThreads,
            fetchArchiveThreads: threadsHook.fetchArchiveThreads,
            fetchBucketThreads: threadsHook.fetchBucketThreads,
            fetchArchiveThreads: threadsHook.fetchArchiveThreads,
            bucketThread: async (threadId, bucketId) => {
                // Helper to normalize subject for thread matching - duplicated from TriageInbox to avoid dependency
                const normalizeSubject = (subject: string): string => {
                    if (!subject) return '';
                    return subject.replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
                };

                // Optimistic Update: Remove from emails list
                const email = emailsHook.emails.find(e => e.id === threadId);
                if (email) {
                    const subject = normalizeSubject(email.subject);
                    emailsHook.setEmails(prev => prev.filter(e => normalizeSubject(e.subject) !== subject));
                } else {
                    // Fallback: just remove by threadId if found
                    emailsHook.setEmails(prev => prev.filter(e => e.id !== threadId));
                }
                return threadsHook.bucketThread(threadId, bucketId);
            },
            archiveThread: async (threadId) => {
                const normalizeSubject = (subject: string): string => {
                    if (!subject) return '';
                    return subject.replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
                };

                // Optimistic Update
                const email = emailsHook.emails.find(e => e.id === threadId);
                if (email) {
                    const subject = normalizeSubject(email.subject);
                    emailsHook.setEmails(prev => prev.filter(e => normalizeSubject(e.subject) !== subject));
                } else {
                    emailsHook.setEmails(prev => prev.filter(e => e.id !== threadId));
                }
                return threadsHook.archiveThread(threadId);
            },
            unarchiveThread: async (threadId, targetLocation, email) => {
                // Optimistic Update: If moving to inbox and we have the email, add it to inbox
                if (targetLocation === 'inbox' && email) {
                    emailsHook.setEmails(prev => {
                        // Check if already exists to avoid duplicates
                        if (prev.some(e => e.id === email.id)) return prev;
                        return [{ ...email, bucketId: undefined }, ...prev];
                    });
                }
                return threadsHook.unarchiveThread(threadId, targetLocation);
            },
            returnThreadToBucket: threadsHook.returnThreadToBucket,
            unbucketThread: threadsHook.unbucketThread
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
