/**
 * Thread Service
 * Handles email threading logic - grouping, thread ID computation, and thread operations
 */
import { db } from './dbService';

/**
 * Normalize a subject line for thread matching.
 * Strips common prefixes like Re:, Fwd:, FW:, etc.
 */
export function normalizeSubject(subject: string): string {
    if (!subject) return '';

    // Strip Re:, Fwd:, FW:, RE:, etc. (repeatedly, for nested prefixes)
    let normalized = subject;
    let prevLength = 0;

    while (normalized.length !== prevLength) {
        prevLength = normalized.length;
        normalized = normalized
            .replace(/^\s*(re|fwd|fw)\s*:\s*/i, '')
            .replace(/^\s*\[.*?\]\s*/, ''); // Also strip [tag] prefixes
    }

    return normalized.trim().toLowerCase();
}

/**
 * Parse References header into array of Message-IDs
 */
export function parseReferences(references: string | null): string[] {
    if (!references) return [];

    // References header contains space or newline separated Message-IDs
    // Each Message-ID is in angle brackets: <message-id@domain>
    const matches = references.match(/<[^>]+>/g);
    return matches ? matches.map(m => m.slice(1, -1)) : [];
}

/**
 * Compute thread_id for an email.
 * Priority: References > In-Reply-To > Normalized Subject matching > Own Message-ID
 */
export async function computeThreadId(
    messageId: string,
    inReplyTo: string | null,
    references: string | null,
    normalizedSubject: string
): Promise<string> {
    const parsedRefs = parseReferences(references);

    // Priority 1: Check if any referenced message has a thread_id
    if (parsedRefs.length > 0) {
        const placeholders = parsedRefs.map(() => '?').join(',');
        const result = await db.query(
            `SELECT thread_id FROM email_metadata WHERE message_id IN (${placeholders}) AND thread_id IS NOT NULL LIMIT 1`,
            parsedRefs
        );
        if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
            return result.rows[0].thread_id;
        }
    }

    // Priority 2: Check In-Reply-To
    if (inReplyTo) {
        // Clean the In-Reply-To (remove angle brackets if present)
        const cleanInReplyTo = inReplyTo.replace(/^<|>$/g, '');
        const result = await db.query(
            `SELECT thread_id FROM email_metadata WHERE message_id = ? AND thread_id IS NOT NULL`,
            [cleanInReplyTo]
        );
        if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
            return result.rows[0].thread_id;
        }
    }

    // Priority 3: Match by normalized subject (lenient matching)
    if (normalizedSubject && normalizedSubject.length > 0) {
        const result = await db.query(
            `SELECT thread_id FROM email_metadata 
             WHERE normalized_subject = ? AND thread_id IS NOT NULL 
             ORDER BY date DESC LIMIT 1`,
            [normalizedSubject]
        );
        if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
            return result.rows[0].thread_id;
        }
    }

    // Default: Use own message_id as thread_id (starts new thread)
    return messageId;
}

interface EmailRow {
    message_id: string;
    uid: number | null;
    subject: string;
    sender: string;
    sender_address: string;
    date: string;
    preview: string;
    snippet: string;
    notes: string | null;
    due_date: string | null;
    bucket_id: string | null;
    original_bucket: string | null;
    date_archived: string | null;
    thread_id: string | null;
    in_reply_to: string | null;
    normalized_subject: string | null;
    mailbox: string | null;
    body_html: string | null;
    body_text: string | null;
}

export const threadService = {
    /**
     * Get all emails grouped by thread for a given context (inbox, bucket, archive)
     * The thread COUNT includes ALL emails in the thread (including archived ones)
     * but which threads APPEAR is based on the context filter
     */
    async getThreadedEmails(context: 'inbox' | 'bucket' | 'archive', bucketId?: string): Promise<any[]> {
        let whereClause: string;
        let params: any[] = [];

        if (context === 'inbox') {
            // Inbox shows: threads that have at least one email that is:
            // - Not in a bucket (original_bucket IS NULL)
            // - Not archived
            // - Not a sent email
            whereClause = `
                WHERE (e.original_bucket IS NULL OR e.original_bucket = '')
                AND (e.date_archived IS NULL OR e.date_archived = '')
                AND (e.mailbox IS NULL OR e.mailbox != 'Sent')
            `;
        } else if (context === 'bucket' && bucketId) {
            // Bucket shows: threads where at least one email is in this bucket and not archived
            whereClause = `
                WHERE e.original_bucket = ?
                AND (e.date_archived IS NULL OR e.date_archived = '')
            `;
            params = [bucketId];
        } else if (context === 'archive') {
            whereClause = `
                WHERE e.date_archived IS NOT NULL AND e.date_archived != ''
            `;
        } else {
            return [];
        }

        console.log(`[ThreadService] getThreadedEmails context=${context}, whereClause=${whereClause.trim()}`);

        // Step 1: Find thread_ids that have at least one email matching the context criteria
        const qualifyingThreadsQuery = `
            SELECT DISTINCT COALESCE(e.thread_id, e.message_id) as thread_id
            FROM email_metadata e
            ${whereClause}
        `;
        const qualifyingResult = await db.query(qualifyingThreadsQuery, params);

        console.log(`[ThreadService] Found ${qualifyingResult.rows?.length || 0} qualifying threads for context=${context}`);

        if (!qualifyingResult.rows || qualifyingResult.rows.length === 0) {
            return [];
        }

        const threadIds = (qualifyingResult.rows as any[]).map(r => r.thread_id);
        const threads: any[] = [];

        // Step 2: For each qualifying thread, get ALL emails (including archived)
        for (const threadId of threadIds) {
            const emailsResult = await db.query(
                `SELECT * FROM email_metadata 
                 WHERE COALESCE(thread_id, message_id) = ?
                 ORDER BY date ASC`,
                [threadId]
            );

            const emailRows = (emailsResult.rows || []) as EmailRow[];

            // Total count includes ALL emails in thread (including archived)
            const totalCount = emailRows.length;

            // Find the latest email (for display purposes)
            const latestEmail = emailRows.reduce((latest, e) => {
                if (!latest || new Date(e.date) > new Date(latest.date)) {
                    return e;
                }
                return latest;
            }, null as EmailRow | null);

            if (!latestEmail) continue;

            const emails = emailRows.map(e => ({
                messageId: e.message_id,
                uid: e.uid,
                subject: e.subject,
                sender: e.sender,
                senderAddress: e.sender_address,
                date: e.date,
                preview: e.preview || e.snippet || '',
                notes: e.notes,
                dueDate: e.due_date,
                bucketId: e.bucket_id,
                originalBucket: e.original_bucket,
                dateArchived: e.date_archived,
                mailbox: e.mailbox
            }));

            // Check if any unbucketed emails exist (for "has new email" indicator)
            const hasUnbucketed = emailRows.some(e =>
                (!e.original_bucket || e.original_bucket === '') &&
                (!e.mailbox || e.mailbox !== 'Sent') &&
                (!e.date_archived || e.date_archived === '')
            );

            // Get original bucket from any email that has one
            const bucketedEmail = emailRows.find(e => e.original_bucket && e.original_bucket !== '');
            const originalBucketId = bucketedEmail?.original_bucket;

            // Check if this is a "resurfaced" thread (has bucket but also has unbucketed emails)
            const hasNewEmail = originalBucketId && hasUnbucketed;

            threads.push({
                threadId,
                latestEmail: {
                    messageId: latestEmail.message_id,
                    uid: latestEmail.uid,
                    subject: latestEmail.subject,
                    sender: latestEmail.sender,
                    senderAddress: latestEmail.sender_address,
                    date: latestEmail.date,
                    preview: latestEmail.preview || latestEmail.snippet || ''
                },
                emails,
                count: totalCount, // TOTAL count including archived
                hasNewEmail,
                originalBucketId
            });
        }

        // Sort by latest email date
        threads.sort((a, b) => new Date(b.latestEmail.date).getTime() - new Date(a.latestEmail.date).getTime());

        return threads;
    },

    /**
     * Move entire thread to a bucket (received emails only)
     * Sets original_bucket to the target bucket ID
     */
    async moveThreadToBucket(threadId: string, bucketId: string): Promise<void> {
        await db.query(
            `UPDATE email_metadata 
             SET original_bucket = ?
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')
             AND (date_archived IS NULL OR date_archived = '')`,
            [bucketId, threadId]
        );
    },

    /**
     * Return thread to its original bucket (for resurfaced threads)
     * This clears new unbucketed emails by setting them to the original bucket
     */
    async returnThreadToBucket(threadId: string): Promise<void> {
        // Get the original bucket from any email in the thread that has one
        const result = await db.query(
            `SELECT original_bucket FROM email_metadata 
             WHERE COALESCE(thread_id, message_id) = ? 
             AND original_bucket IS NOT NULL AND original_bucket != ''
             LIMIT 1`,
            [threadId]
        );

        if (result.rows && result.rows.length > 0 && result.rows[0].original_bucket) {
            const originalBucket = result.rows[0].original_bucket;
            // Set all unbucketed emails in the thread to this bucket
            await db.query(
                `UPDATE email_metadata 
                 SET original_bucket = ?
                 WHERE COALESCE(thread_id, message_id) = ? 
                 AND (mailbox IS NULL OR mailbox != 'Sent')
                 AND (original_bucket IS NULL OR original_bucket = '')`,
                [originalBucket, threadId]
            );
        }
    },

    /**
     * Archive entire thread (received emails only)
     * Sets date_archived in DB AND moves emails to IMAP Archive folder
     * ATOMIC: If any email fails to archive, the entire operation fails
     */
    async archiveThread(threadId: string): Promise<void> {
        console.log(`[ThreadService] Archiving thread ${threadId}`);

        // First, get all message_ids for this thread (non-archived, non-sent)
        const result = await db.query(
            `SELECT message_id, original_bucket FROM email_metadata 
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')
             AND (date_archived IS NULL OR date_archived = '')`,
            [threadId]
        );

        const emails = (result.rows || []) as { message_id: string; original_bucket: string | null }[];
        console.log(`[ThreadService] Found ${emails.length} emails to archive in thread`);

        if (emails.length === 0) return;

        // Get the original bucket from the first email that has one (for restoration reference)
        const originalBucket = emails.find(e => e.original_bucket)?.original_bucket || null;

        // Import IMAP service to archive each email
        const { imapService } = await import('./imapService');

        // ATOMIC: Track all operations - if any fails, abort and throw
        const failedEmails: { messageId: string; error: string }[] = [];
        const successfulEmails: string[] = [];

        // Archive each email in IMAP
        for (const email of emails) {
            try {
                await imapService.archiveEmail(email.message_id);
                successfulEmails.push(email.message_id);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error(`[ThreadService] Failed to archive email ${email.message_id} in IMAP:`, errorMsg);
                failedEmails.push({ messageId: email.message_id, error: errorMsg });
            }
        }

        // ATOMIC: If ANY email failed, do NOT update DB - thread must stay together
        if (failedEmails.length > 0) {
            const failedIds = failedEmails.map(e => e.messageId).join(', ');
            const errorMessage = `Thread archive failed: ${failedEmails.length} of ${emails.length} emails could not be archived. Failed: ${failedIds}`;
            console.error(`[ThreadService] ${errorMessage}`);
            // TODO: Consider rolling back the successful archives here
            throw new Error(errorMessage);
        }

        // Only update DB if ALL emails archived successfully
        const now = new Date().toISOString();
        await db.query(
            `UPDATE email_metadata 
             SET date_archived = ?, original_bucket = COALESCE(original_bucket, ?)
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')`,
            [now, originalBucket, threadId]
        );

        console.log(`[ThreadService] Successfully archived ${emails.length} emails in thread ${threadId}`);
    },

    /**
     * Unbucket entire thread (move all emails back to inbox)
     * Clears original_bucket for all emails in the thread
     */
    async unbucketThread(threadId: string): Promise<void> {
        console.log(`[ThreadService] Unbucketing thread ${threadId}`);
        const result = await db.query(
            `UPDATE email_metadata 
             SET original_bucket = NULL
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')`,
            [threadId]
        );
        console.log(`[ThreadService] Unbucketed thread, affected emails`);
    },

    /**
     * Unarchive entire thread (move all emails from Archive back to inbox or bucket)
     * Moves emails in IMAP and clears date_archived in DB
     */
    async unarchiveThread(threadId: string, targetLocation: string): Promise<{ moved: number; failed: string[] }> {
        console.log(`[ThreadService] Unarchiving thread ${threadId} to ${targetLocation}`);

        // Get all archived emails in this thread
        const result = await db.query(
            `SELECT message_id FROM email_metadata 
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')
             AND date_archived IS NOT NULL AND date_archived != ''`,
            [threadId]
        );

        const emails = (result.rows || []) as { message_id: string }[];
        console.log(`[ThreadService] Found ${emails.length} archived emails to unarchive in thread`);

        if (emails.length === 0) {
            return { moved: 0, failed: [] };
        }

        const { imapService } = await import('./imapService');

        let moved = 0;
        const failed: string[] = [];

        // Move each email from Archive back to target
        for (const email of emails) {
            try {
                await imapService.unarchiveEmail(email.message_id, targetLocation);
                moved++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[ThreadService] Failed to unarchive email ${email.message_id}: ${msg}`);
                failed.push(email.message_id);
            }
        }

        // If any failed, throw error to maintain atomicity
        if (failed.length > 0) {
            throw new Error(`Thread unarchive failed: ${failed.length} of ${emails.length} emails could not be moved`);
        }

        // Update DB - clear date_archived, optionally set bucket
        if (targetLocation === 'inbox') {
            await db.query(
                `UPDATE email_metadata 
                 SET date_archived = NULL, original_bucket = NULL
                 WHERE COALESCE(thread_id, message_id) = ? 
                 AND (mailbox IS NULL OR mailbox != 'Sent')`,
                [threadId]
            );
        } else {
            // Moving to a bucket
            await db.query(
                `UPDATE email_metadata 
                 SET date_archived = NULL, original_bucket = ?
                 WHERE COALESCE(thread_id, message_id) = ? 
                 AND (mailbox IS NULL OR mailbox != 'Sent')`,
                [targetLocation, threadId]
            );
        }

        console.log(`[ThreadService] Successfully unarchived ${moved} emails in thread ${threadId}`);
        return { moved, failed };
    },

    /**
     * Consolidate a fragmented thread - move ALL emails to a single IMAP location
     * This is a repair function for threads that got split across inbox/archive/buckets
     */
    async consolidateThread(threadId: string, target: 'archive' | 'inbox'): Promise<{ movedToTarget: number; alreadyInTarget: number; failed: string[] }> {
        console.log(`[ThreadService] Consolidating thread ${threadId} to ${target}`);

        // Get ALL emails in this thread (including archived, bucketed, etc.)
        const result = await db.query(
            `SELECT message_id, date_archived, original_bucket FROM email_metadata 
             WHERE COALESCE(thread_id, message_id) = ? 
             AND (mailbox IS NULL OR mailbox != 'Sent')`,
            [threadId]
        );

        const emails = (result.rows || []) as { message_id: string; date_archived: string | null; original_bucket: string | null }[];
        console.log(`[ThreadService] Found ${emails.length} emails in thread to consolidate`);

        if (emails.length === 0) {
            return { movedToTarget: 0, alreadyInTarget: 0, failed: [] };
        }

        const { imapService } = await import('./imapService');

        let movedToTarget = 0;
        let alreadyInTarget = 0;
        const failed: string[] = [];

        for (const email of emails) {
            try {
                if (target === 'archive') {
                    // Move to archive
                    await imapService.archiveEmail(email.message_id);
                    movedToTarget++;
                } else {
                    // Move to inbox - need to unarchive if archived
                    if (email.date_archived) {
                        await imapService.unarchiveEmail(email.message_id, 'inbox');
                        movedToTarget++;
                    } else {
                        alreadyInTarget++;
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                // Check if it's already in target (not a real failure)
                if (msg.includes('already in Archives')) {
                    alreadyInTarget++;
                } else {
                    console.error(`[ThreadService] Failed to move ${email.message_id}: ${msg}`);
                    failed.push(email.message_id);
                }
            }
        }

        // Update database to reflect new state
        const now = new Date().toISOString();
        if (target === 'archive') {
            await db.query(
                `UPDATE email_metadata 
                 SET date_archived = COALESCE(date_archived, ?)
                 WHERE COALESCE(thread_id, message_id) = ? 
                 AND (mailbox IS NULL OR mailbox != 'Sent')`,
                [now, threadId]
            );
        } else {
            await db.query(
                `UPDATE email_metadata 
                 SET date_archived = NULL, original_bucket = NULL
                 WHERE COALESCE(thread_id, message_id) = ? 
                 AND (mailbox IS NULL OR mailbox != 'Sent')`,
                [threadId]
            );
        }

        console.log(`[ThreadService] Consolidation complete: ${movedToTarget} moved, ${alreadyInTarget} already in ${target}, ${failed.length} failed`);
        return { movedToTarget, alreadyInTarget, failed };
    },

    /**
     * Backfill thread_ids for existing emails by grouping on normalized subject.
     * This is more aggressive than computeThreadId - it will group ALL emails
     * with the same normalized subject into one thread.
     */
    async backfillThreadIds(): Promise<number> {
        // Step 1: Compute normalized_subject for all emails missing it
        const needsNormalized = await db.query(
            `SELECT message_id, subject FROM email_metadata WHERE normalized_subject IS NULL`
        );

        for (const row of (needsNormalized.rows || []) as any[]) {
            const normalized = normalizeSubject(row.subject || '');
            await db.query(
                `UPDATE email_metadata SET normalized_subject = ? WHERE message_id = ?`,
                [normalized, row.message_id]
            );
        }
        console.log(`[Backfill] Normalized ${needsNormalized.rows?.length || 0} subjects`);

        // Step 2: Group emails by normalized_subject and assign thread_ids
        // For each unique normalized_subject, use the oldest email's message_id as the thread_id
        const subjectGroups = await db.query(`
            SELECT normalized_subject, 
                   MIN(message_id) as oldest_message_id,
                   COUNT(*) as email_count
            FROM email_metadata 
            WHERE normalized_subject IS NOT NULL AND normalized_subject != ''
            GROUP BY normalized_subject
            HAVING COUNT(*) > 1
        `);

        let updated = 0;
        for (const group of (subjectGroups.rows || []) as any[]) {
            const threadId = group.oldest_message_id;
            const normalized = group.normalized_subject;

            // Update all emails with this normalized subject to have the same thread_id
            await db.query(
                `UPDATE email_metadata 
                 SET thread_id = ?
                 WHERE normalized_subject = ?`,
                [threadId, normalized]
            );
            updated += group.email_count;
            console.log(`[Backfill] Thread "${normalized.substring(0, 40)}..." → ${group.email_count} emails`);
        }

        // Step 3: For emails that are alone (no duplicate subjects), set thread_id = message_id
        await db.query(`
            UPDATE email_metadata 
            SET thread_id = message_id
            WHERE thread_id IS NULL
        `);

        console.log(`[Backfill] Complete: ${updated} emails grouped into threads`);
        return updated;
    }
};

export default threadService;
