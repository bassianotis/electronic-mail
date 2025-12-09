/**
 * useEmails Hook
 * Manages email fetching, archiving, bucketing, and updates
 */
import { useState, useCallback } from 'react';
import { type Email, type ApiEmailResponse } from '../store/mailStore';
import { mapApiResponsesToEmails } from '../utils/emailMapper';
import { extractFirstParagraph } from '../utils/emailUtils';

export interface UseEmailsReturn {
    emails: Email[];
    setEmails: React.Dispatch<React.SetStateAction<Email[]>>;
    isLoading: boolean;
    isSyncing: boolean;
    fetchInboxEmails: () => Promise<void>;
    archiveEmail: (id: string, refetchBuckets: () => Promise<void>, bucketId?: string) => Promise<void>;
    unarchiveEmail: (email: Email, targetLocation: string, refetchBuckets: () => Promise<void>, fetchInbox: () => Promise<void>) => Promise<void>;
    bucketEmail: (id: string, bucketId: string, refetchBuckets: () => Promise<void>) => Promise<void>;
    updateEmail: (id: string, updates: Partial<Email>) => Promise<void>;
    loadEmailBody: (id: string, uid?: string) => Promise<any>;
    markAsRead: (id: string, uid?: string) => Promise<void>;
    triggerSync: (fetchInbox: () => Promise<void>) => Promise<void>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useEmails(): UseEmailsReturn {
    const [emails, setEmails] = useState<Email[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchInboxEmails = useCallback(async () => {
        try {
            const res = await fetch('/api/inbox');
            if (res.ok) {
                const data: ApiEmailResponse[] = await res.json();
                const mappedEmails = mapApiResponsesToEmails(data);
                setEmails(mappedEmails);
            }
        } catch (err) {
            console.error('Error fetching inbox:', err);
        }
    }, []);

    const triggerSync = useCallback(async (fetchInbox: () => Promise<void>) => {
        setIsSyncing(true);
        try {
            await fetch('/api/sync?wait=true', { method: 'POST' });
            await fetchInbox();
        } catch (err) {
            console.error('Failed to trigger sync:', err);
        } finally {
            setIsSyncing(false);
        }
    }, []);

    // Helper to insert email in sorted order (newest first)
    const insertSorted = (currentEmails: Email[], newEmail: Email) => {
        const newDate = new Date(newEmail.date).getTime();
        const index = currentEmails.findIndex(e => new Date(e.date).getTime() < newDate);
        if (index === -1) return [...currentEmails, newEmail];
        const newEmails = [...currentEmails];
        newEmails.splice(index, 0, newEmail);
        return newEmails;
    };

    const archiveEmail = useCallback(async (id: string, refetchBuckets: () => Promise<void>, bucketIdOverride?: string) => {
        const email = emails.find(e => e.id === id);
        const bucketId = bucketIdOverride || email?.bucketId;
        console.log(`[FRONTEND] Archiving email ${id} with bucketId: ${bucketId}`, email);

        // Optimistic: remove from emails
        setEmails(prev => prev.filter(e => e.id !== id));

        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('emailArchived', { detail: { emailId: id } }));

        try {
            await fetch(`/api/emails/${id}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId, messageId: id })
            });
            await refetchBuckets();
        } catch (err) {
            console.error('Failed to archive email:', err);
        }
    }, [emails]);

    const unarchiveEmail = useCallback(async (
        email: Email,
        targetLocation: string,
        refetchBuckets: () => Promise<void>,
        fetchInbox: () => Promise<void>
    ) => {
        const id = email.id;

        try {
            // Optimistic update
            if (targetLocation === 'inbox') {
                const existingEmail = emails.find(e => e.id === id);
                if (existingEmail) {
                    setEmails(prev => prev.map(e => {
                        if (e.id === id) {
                            const { bucketId, dateArchived, originalBucket, ...rest } = e;
                            return rest;
                        }
                        return e;
                    }));
                } else {
                    const { bucketId, dateArchived, originalBucket, ...emailWithoutBucket } = email;
                    setEmails(prev => insertSorted(prev, emailWithoutBucket));
                }
            } else {
                const existingEmail = emails.find(e => e.id === id);
                if (existingEmail) {
                    setEmails(prev => prev.map(e => e.id === id ? { ...e, bucketId: targetLocation, dateArchived: undefined, originalBucket: undefined } : e));
                } else {
                    setEmails(prev => insertSorted(prev, { ...email, bucketId: targetLocation, dateArchived: undefined, originalBucket: undefined }));
                }
            }

            const res = await fetch(`/api/emails/${id}/unarchive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetLocation })
            });

            if (res.ok) {
                await refetchBuckets();
                if (targetLocation === 'inbox') await fetchInbox();

                // Dispatch event for UI feedback
                window.dispatchEvent(new CustomEvent('emailRestored', {
                    detail: { email, targetLocation }
                }));
            }
        } catch (err) {
            console.error('❌ UNARCHIVE ERROR:', err);
        }
    }, [emails]);

    const bucketEmail = useCallback(async (id: string, bucketId: string, refetchBuckets: () => Promise<void>) => {
        try {
            const email = emails.find(e => e.id === id);
            const messageId = email?.messageId || id;

            // Prepare email data for immediate DB storage
            const emailData = email ? {
                subject: email.subject,
                from: [{ name: email.sender, address: email.senderAddress }],
                date: email.date,
                uid: email.uid
            } : undefined;

            if (bucketId === 'inbox' || bucketId === null) {
                // Unbucketing - first make API call
                await fetch(`/api/emails/${id}/bucket`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: [], messageId, emailData })
                });

                // Then immediately fetch inbox to get the email
                await fetchInboxEmails();
                await refetchBuckets();
            } else {
                // Normal bucketing - optimistic update first (remove from current view)
                // Normal bucketing
                // 1. Optimistic: Update local state immediately
                setEmails(prev => prev.map(e => e.id === id ? { ...e, bucketId } : e));

                // 2. If we are in Inbox view, we might want to remove it, but let's keep it consistent
                // Actually, if we are in Inbox, it should disappear.
                // But wait, the user flow is: Drag to bucket -> Open Bucket -> Click Archive.
                // So the `emails` state when clicking Archive is populated by `fetchBucketEmails`.

                // Let's rely on refetchBuckets and whatever the current view logic is.
                // If I just remove it, it's gone from the current view.
                setEmails(prev => prev.filter(e => e.id !== id));

                await fetch(`/api/emails/${id}/bucket`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: [bucketId], messageId, emailData })
                });

                await refetchBuckets();
            }
        } catch (err) {
            console.error('Failed to bucket email:', err);
            // Rollback: re-fetch to restore state
            await fetchInboxEmails();
        }
    }, [emails, fetchInboxEmails]);

    const updateEmail = useCallback(async (id: string, updates: Partial<Email>) => {
        const currentEmail = emails.find(e => e.id === id);
        const messageId = (currentEmail as any)?.messageId || updates.messageId;

        const finalNote = updates.note !== undefined ? updates.note : currentEmail?.note;
        const finalDueDate = updates.dueDate !== undefined ? updates.dueDate : currentEmail?.dueDate;

        if (currentEmail) {
            setEmails(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
        }

        window.dispatchEvent(new CustomEvent('emailUpdated', { detail: { id, updates } }));

        if (Object.hasOwn(updates, 'note') || Object.hasOwn(updates, 'dueDate')) {
            if (messageId) {
                try {
                    await fetch('/api/emails/metadata', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messageId, notes: finalNote, dueDate: finalDueDate })
                    });
                } catch (err) {
                    console.error('Failed to update metadata:', err);
                }
            }
        }
    }, [emails]);

    const loadEmailBody = useCallback(async (id: string, uid?: string) => {
        const email = emails.find(e => e.id === id);
        console.log(`[loadEmailBody] id=${id.substring(0, 30)}, uid=${uid}, existingBody=${email?.body?.substring(0, 30)}`);

        if (email && email.body !== '<p>Loading body...</p>') {
            console.log(`[loadEmailBody] Using cached body for ${id.substring(0, 30)}`);
            return { html: email.body, text: email.preview, attachments: email.attachments };
        }

        try {
            const effectiveUid = uid || email?.uid;
            const url = effectiveUid ? `/api/emails/${encodeURIComponent(id)}?uid=${effectiveUid}` : `/api/emails/${encodeURIComponent(id)}`;
            console.log(`[loadEmailBody] Fetching from ${url}`);
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                console.log(`[loadEmailBody] Got response, html length=${data.html?.length}, hasHtml=${!!data.html}`);
                const preview = extractFirstParagraph(data.html, 150);

                setEmails(prev => prev.map(e => {
                    if (e.id === id) {
                        return { ...e, body: data.html, preview, attachments: data.attachments || [] };
                    }
                    return e;
                }));

                window.dispatchEvent(new CustomEvent('emailBodyLoaded', {
                    detail: { emailId: id, body: data.html, preview, attachments: data.attachments || [] }
                }));

                fetch('/api/emails/metadata', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageId: id, preview })
                }).catch(err => console.error('Failed to save preview:', err));

                return data;
            } else {
                console.error(`[loadEmailBody] HTTP error: ${res.status}`);
                const errorBody = '<p style="color: red;">Error: Could not load email body.</p>';
                setEmails(prev => prev.map(e => e.id === id ? { ...e, body: errorBody } : e));
                return { html: errorBody };
            }
        } catch (err) {
            console.error('Failed to load email body:', err);
            const errorBody = '<p style="color: red;">Error: Could not load email body.</p>';
            setEmails(prev => prev.map(e => e.id === id ? { ...e, body: errorBody } : e));
            return { html: errorBody };
        }
    }, [emails]);

    const markAsRead = useCallback(async (id: string, uid?: string) => {
        try {
            let effectiveUid = uid;
            if (!effectiveUid) {
                const email = emails.find(e => e.id === id);
                if (email?.uid) effectiveUid = email.uid;
            }

            const url = effectiveUid ? `/api/emails/${id}/mark-read?uid=${effectiveUid}` : `/api/emails/${id}/mark-read`;
            await fetch(url, { method: 'POST' });
            setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e));
        } catch (err) {
            console.error('Failed to mark as read:', err);
        }
    }, [emails]);

    return {
        emails,
        setEmails,
        isLoading,
        isSyncing,
        setIsLoading,
        setIsSyncing,
        fetchInboxEmails,
        archiveEmail,
        unarchiveEmail,
        bucketEmail,
        updateEmail,
        loadEmailBody,
        markAsRead,
        triggerSync
    };
}
