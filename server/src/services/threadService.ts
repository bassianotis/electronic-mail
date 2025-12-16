/**
 * Thread Service
 * Handles email thread grouping, operations, and atomicity
 */
import { db } from './dbService';
import { imapService } from './imapService';

/**
 * Normalize subject by removing Re:/Fwd: prefixes
 */
export function normalizeSubject(subject: string): string {
    if (!subject) return '';
    return subject
        .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Compute thread ID for an email based on References, In-Reply-To, or normalized subject
 */
export async function computeThreadId(
    messageId: string,
    inReplyTo: string | null,
    refs: string | null,
    normalizedSubject: string
): Promise<string> {
    // Priority 1: Check References header
    if (refs) {
        const refList = refs.split(/\s+/).filter(r => r.trim());
        for (const ref of refList) {
            const result = await db.query(
                'SELECT thread_id FROM email_metadata WHERE message_id = ? AND thread_id IS NOT NULL',
                [ref]
            );
            if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
                return result.rows[0].thread_id;
            }
        }
    }

    // Priority 2: Check In-Reply-To header
    if (inReplyTo) {
        const result = await db.query(
            'SELECT thread_id FROM email_metadata WHERE message_id = ? AND thread_id IS NOT NULL',
            [inReplyTo]
        );
        if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
            return result.rows[0].thread_id;
        }
    }

    // Priority 3: Match by normalized subject
    if (normalizedSubject && normalizedSubject.length > 3) {
        const result = await db.query(
            'SELECT thread_id FROM email_metadata WHERE normalized_subject = ? AND thread_id IS NOT NULL LIMIT 1',
            [normalizedSubject]
        );
        if (result.rows && result.rows.length > 0 && result.rows[0].thread_id) {
            return result.rows[0].thread_id;
        }
    }

    // Fallback: Use own message_id as thread_id
    return messageId;
}


/**
 * Get all message_ids that belong to the same thread
 * Uses normalized_subject matching with fallback to thread_id
 */
async function getThreadEmailIds(threadIdOrMessageId: string): Promise<string[]> {
    // First, try to find the email and get its subject
    const emailResult = await db.query(`
        SELECT message_id, subject, thread_id, normalized_subject, original_bucket FROM email_metadata
        WHERE message_id = ? OR thread_id = ?
        LIMIT 1
    `, [threadIdOrMessageId, threadIdOrMessageId]);

    if (!emailResult.rows || emailResult.rows.length === 0) {
        // No email found, just return the single ID
        console.log(`[threadService] getThreadEmailIds: No email found for ${threadIdOrMessageId}`);
        return [threadIdOrMessageId];
    }

    const email = emailResult.rows[0];
    const normalizedSubj = email.normalized_subject || normalizeSubject(email.subject || '');
    const bucketId = email.original_bucket;

    console.log(`[threadService] getThreadEmailIds: Looking for thread with subject "${normalizedSubj}" in bucket ${bucketId}`);

    if (!normalizedSubj) {
        // No subject to match on, return just this email
        return [email.message_id];
    }

    // Query ALL emails in the same location (bucket or unbucketed)
    // Then filter by normalized subject in JavaScript for reliability
    let allEmails;
    if (bucketId) {
        // Find all emails in this bucket
        allEmails = await db.query(`
            SELECT message_id, subject FROM email_metadata
            WHERE original_bucket = ?
              AND (date_archived IS NULL OR date_archived = '')
              AND (mailbox IS NULL OR mailbox != 'Sent')
        `, [bucketId]);
    } else {
        // Find all unbucketed emails in inbox
        allEmails = await db.query(`
            SELECT message_id, subject FROM email_metadata
            WHERE (original_bucket IS NULL OR original_bucket = '')
              AND (date_archived IS NULL OR date_archived = '')
              AND (mailbox IS NULL OR mailbox != 'Sent')
        `);
    }

    if (!allEmails.rows || allEmails.rows.length === 0) {
        return [email.message_id];
    }

    // Filter by normalized subject in JavaScript
    const matchingIds = allEmails.rows
        .filter((row: { subject: string }) => normalizeSubject(row.subject || '') === normalizedSubj)
        .map((row: { message_id: string }) => row.message_id);

    console.log(`[threadService] getThreadEmailIds: Found ${matchingIds.length} emails in thread`);

    return matchingIds.length > 0 ? matchingIds : [email.message_id];
}

interface ThreadGroup {
    threadId: string;
    count: number;
    latestEmail: {
        messageId: string;
        uid: number;
        subject: string;
        sender: string;
        senderAddress: string;
        date: string;
        preview: string;
        body?: string;
    };
    hasNewEmail?: boolean;
    originalBucketId?: string;
}

/**
 * Get inbox threads (unbucketed, unarchived emails grouped by thread)
 */
export async function getInboxThreads(): Promise<ThreadGroup[]> {
    const result = await db.query(`
        SELECT 
            COALESCE(thread_id, message_id) as thread_id,
            message_id,
            subject,
            normalized_subject,
            sender,
            sender_address,
            date,
            snippet,
            preview,
            uid,
            original_bucket,
            body_html
        FROM email_metadata
        WHERE (original_bucket IS NULL OR original_bucket = '')
          AND (date_archived IS NULL OR date_archived = '')
          AND (mailbox IS NULL OR mailbox != 'Sent')
        ORDER BY date DESC
    `);

    if (!result.rows) return [];

    // Group by thread_id
    const threadMap = new Map<string, any[]>();
    for (const row of result.rows) {
        const tid = row.thread_id || row.message_id;
        if (!threadMap.has(tid)) {
            threadMap.set(tid, []);
        }
        threadMap.get(tid)!.push(row);
    }

    // Get all unique normalized subjects for batch count lookup
    const subjects = new Set<string>();
    for (const emails of threadMap.values()) {
        const subject = emails[0]?.normalized_subject || normalizeSubject(emails[0]?.subject || '');
        if (subject) subjects.add(subject);
    }

    // Batch get counts for all subjects (including sent emails)
    const subjectCounts = new Map<string, number>();
    if (subjects.size > 0) {
        const placeholders = Array.from(subjects).map(() => '?').join(',');
        const countResult = await db.query(`
            SELECT normalized_subject, COUNT(*) as count 
            FROM email_metadata 
            WHERE normalized_subject IN (${placeholders})
            GROUP BY normalized_subject
        `, Array.from(subjects));

        for (const row of (countResult.rows || [])) {
            subjectCounts.set(row.normalized_subject, row.count);
        }
    }

    // Convert to ThreadGroup array
    const threads: ThreadGroup[] = [];
    for (const [threadId, emails] of threadMap) {
        // Sort by date descending to get latest
        emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latest = emails[0];
        const normalizedSubj = latest.normalized_subject || normalizeSubject(latest.subject || '');

        // Use batch count (includes sent emails), fallback to received-only count
        const totalCount = subjectCounts.get(normalizedSubj) || emails.length;

        threads.push({
            threadId,
            count: totalCount,
            latestEmail: {
                messageId: latest.message_id,
                uid: latest.uid,
                subject: latest.subject || '(No Subject)',
                sender: latest.sender || 'Unknown',
                senderAddress: latest.sender_address || '',
                date: latest.date,
                preview: latest.preview || latest.snippet || '',
                body: latest.body_html || undefined
            },
            originalBucketId: latest.original_bucket || undefined
        });
    }

    // Sort threads by latest email date
    threads.sort((a, b) => new Date(b.latestEmail.date).getTime() - new Date(a.latestEmail.date).getTime());

    return threads;
}

/**
 * Get bucket threads (emails in a specific bucket grouped by thread)
 */
export async function getBucketThreads(bucketId: string): Promise<ThreadGroup[]> {
    const result = await db.query(`
        SELECT 
            COALESCE(thread_id, message_id) as thread_id,
            message_id,
            subject,
            normalized_subject,
            sender,
            sender_address,
            date,
            snippet,
            preview,
            uid,
            original_bucket,
            body_html
        FROM email_metadata
        WHERE original_bucket = ?
          AND (date_archived IS NULL OR date_archived = '')
          AND (mailbox IS NULL OR mailbox != 'Sent')
        ORDER BY date DESC
    `, [bucketId]);

    if (!result.rows) return [];

    // Group by thread_id
    const threadMap = new Map<string, any[]>();
    for (const row of result.rows) {
        const tid = row.thread_id || row.message_id;
        if (!threadMap.has(tid)) {
            threadMap.set(tid, []);
        }
        threadMap.get(tid)!.push(row);
    }

    // Get all unique normalized subjects for batch count lookup
    const subjects = new Set<string>();
    for (const emails of threadMap.values()) {
        const subject = emails[0]?.normalized_subject || normalizeSubject(emails[0]?.subject || '');
        if (subject) subjects.add(subject);
    }

    // Batch get counts for all subjects (including sent emails)
    const subjectCounts = new Map<string, number>();
    if (subjects.size > 0) {
        const placeholders = Array.from(subjects).map(() => '?').join(',');
        const countResult = await db.query(`
            SELECT normalized_subject, COUNT(*) as count 
            FROM email_metadata 
            WHERE normalized_subject IN (${placeholders})
            GROUP BY normalized_subject
        `, Array.from(subjects));

        for (const row of (countResult.rows || [])) {
            subjectCounts.set(row.normalized_subject, row.count);
        }
    }

    // Convert to ThreadGroup array
    const threads: ThreadGroup[] = [];
    for (const [threadId, emails] of threadMap) {
        emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latest = emails[0];
        const normalizedSubj = latest.normalized_subject || normalizeSubject(latest.subject || '');

        // Use batch count (includes sent emails), fallback to received-only count
        const totalCount = subjectCounts.get(normalizedSubj) || emails.length;

        threads.push({
            threadId,
            count: totalCount,
            latestEmail: {
                messageId: latest.message_id,
                uid: latest.uid,
                subject: latest.subject || '(No Subject)',
                sender: latest.sender || 'Unknown',
                senderAddress: latest.sender_address || '',
                date: latest.date,
                preview: latest.preview || latest.snippet || '',
                body: latest.body_html || undefined
            },
            originalBucketId: bucketId
        });
    }

    threads.sort((a, b) => new Date(b.latestEmail.date).getTime() - new Date(a.latestEmail.date).getTime());
    return threads;
}

/**
 * Get archive threads (archived emails grouped by thread)
 */
export async function getArchiveThreads(): Promise<ThreadGroup[]> {
    const result = await db.query(`
        SELECT 
            COALESCE(thread_id, message_id) as thread_id,
            message_id,
            subject,
            normalized_subject,
            sender,
            sender_address,
            date,
            snippet,
            preview,
            uid,
            original_bucket,
            date_archived,
            body_html
        FROM email_metadata
        WHERE date_archived IS NOT NULL AND date_archived != ''
          AND (mailbox IS NULL OR mailbox != 'Sent')
        ORDER BY date_archived DESC
    `);

    if (!result.rows) return [];

    // Group by thread_id
    const threadMap = new Map<string, any[]>();
    for (const row of result.rows) {
        const tid = row.thread_id || row.message_id;
        if (!threadMap.has(tid)) {
            threadMap.set(tid, []);
        }
        threadMap.get(tid)!.push(row);
    }

    // Get all unique normalized subjects for batch count lookup
    const subjects = new Set<string>();
    for (const emails of threadMap.values()) {
        const subject = emails[0]?.normalized_subject || normalizeSubject(emails[0]?.subject || '');
        if (subject) subjects.add(subject);
    }

    // Batch get counts for all subjects (including sent emails)
    const subjectCounts = new Map<string, number>();
    if (subjects.size > 0) {
        const placeholders = Array.from(subjects).map(() => '?').join(',');
        const countResult = await db.query(`
            SELECT normalized_subject, COUNT(*) as count 
            FROM email_metadata 
            WHERE normalized_subject IN (${placeholders})
            GROUP BY normalized_subject
        `, Array.from(subjects));

        for (const row of (countResult.rows || [])) {
            subjectCounts.set(row.normalized_subject, row.count);
        }
    }

    // Convert to ThreadGroup array
    const threads: ThreadGroup[] = [];
    for (const [threadId, emails] of threadMap) {
        emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latest = emails[0];
        const normalizedSubj = latest.normalized_subject || normalizeSubject(latest.subject || '');

        // Use batch count (includes sent emails), fallback to received-only count
        const totalCount = subjectCounts.get(normalizedSubj) || emails.length;

        threads.push({
            threadId,
            count: totalCount,
            latestEmail: {
                messageId: latest.message_id,
                uid: latest.uid,
                subject: latest.subject || '(No Subject)',
                sender: latest.sender || 'Unknown',
                senderAddress: latest.sender_address || '',
                date: latest.date,
                preview: latest.preview || latest.snippet || '',
                body: latest.body_html || undefined
            },
            originalBucketId: latest.original_bucket || undefined
        });
    }

    threads.sort((a, b) => new Date(b.latestEmail.date).getTime() - new Date(a.latestEmail.date).getTime());
    return threads;
}

/**
 * Move entire thread to a bucket (atomic operation)
 */
export async function moveThreadToBucket(threadId: string, bucketId: string): Promise<void> {
    // Get all emails in this thread using normalized_subject matching
    const emailIds = await getThreadEmailIds(threadId);

    if (emailIds.length === 0) {
        throw new Error(`No emails found in thread ${threadId}`);
    }

    console.log(`[threadService] Moving ${emailIds.length} emails in thread ${threadId} to bucket ${bucketId}`);

    // Step 1: Add IMAP bucket labels for each email
    // Note: We need to know which label corresponds to the bucket ID.
    // For now, assuming bucketId IS the label (e.g. $label1).
    // If bucketId is internal ID, we would need to look it up, but current app uses labels as IDs.
    const failed: string[] = [];
    for (const messageId of emailIds) {
        try {
            await imapService.assignTags(messageId, [bucketId]);
        } catch (err) {
            console.error(`[threadService] Failed to add bucket label to ${messageId}:`, err);
            failed.push(messageId);
        }
    }

    // If any failed, throw error (atomicity)
    if (failed.length > 0) {
        throw new Error(`Thread bucket move failed: ${failed.length}/${emailIds.length} emails could not be bucketed`);
    }

    // Step 2: Update database only on 100% IMAP success
    const placeholders = emailIds.map(() => '?').join(',');
    await db.query(`
        UPDATE email_metadata 
        SET original_bucket = ?, date_archived = NULL
        WHERE message_id IN (${placeholders})
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `, [bucketId, ...emailIds]);

    console.log(`[threadService] Moved ${emailIds.length} emails in thread ${threadId} to bucket ${bucketId} (IMAP + DB)`);
}

/**
 * Archive entire thread (atomic operation)
 */
export async function archiveThread(threadId: string): Promise<void> {
    // Get all emails in this thread using normalized_subject matching
    const emailIds = await getThreadEmailIds(threadId);

    if (emailIds.length === 0) {
        console.log(`[threadService] No emails found for thread ${threadId}`);
        return;
    }

    // Filter to only unarchived emails
    const placeholders = emailIds.map(() => '?').join(',');
    const result = await db.query(`
        SELECT message_id FROM email_metadata
        WHERE message_id IN (${placeholders})
          AND (date_archived IS NULL OR date_archived = '')
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `, emailIds);

    if (!result.rows || result.rows.length === 0) {
        console.log(`[threadService] No unarchived emails in thread ${threadId}`);
        return;
    }

    console.log(`[threadService] Archiving ${result.rows.length} emails in thread ${threadId}`);

    // Move each email in IMAP
    const failed: string[] = [];
    for (const row of result.rows) {
        try {
            await imapService.archiveEmail(row.message_id);
        } catch (err) {
            console.error(`[threadService] Failed to archive email ${row.message_id}:`, err);
            failed.push(row.message_id);
        }
    }

    // If any failed, throw error (atomicity)
    if (failed.length > 0) {
        throw new Error(`Thread archive failed: ${failed.length}/${result.rows.length} emails could not be archived`);
    }

    // Update database only on 100% success
    const now = new Date().toISOString();
    const updatePlaceholders = emailIds.map(() => '?').join(',');
    await db.query(`
        UPDATE email_metadata 
        SET date_archived = ?
        WHERE message_id IN (${updatePlaceholders})
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `, [now, ...emailIds]);

    console.log(`[threadService] Thread ${threadId} archived successfully`);
}

/**
 * Unarchive entire thread (atomic operation)
 */
export async function unarchiveThread(threadId: string, targetLocation: string): Promise<void> {
    // Step 1: Find the source email and get its normalized subject
    const emailResult = await db.query(`
        SELECT message_id, subject, normalized_subject FROM email_metadata
        WHERE message_id = ? OR thread_id = ?
        LIMIT 1
    `, [threadId, threadId]);

    if (!emailResult.rows || emailResult.rows.length === 0) {
        console.log(`[threadService] unarchiveThread: No email found for ${threadId}`);
        return;
    }

    const email = emailResult.rows[0];
    const normalizedSubj = email.normalized_subject || normalizeSubject(email.subject || '');

    console.log(`[threadService] unarchiveThread: Looking for archived thread with subject "${normalizedSubj}"`);

    if (!normalizedSubj) {
        console.log(`[threadService] unarchiveThread: No subject to match on`);
        return;
    }

    // Step 2: Find ALL archived emails with matching normalized subject
    const allArchivedResult = await db.query(`
        SELECT message_id, subject FROM email_metadata
        WHERE date_archived IS NOT NULL AND date_archived != ''
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `);

    if (!allArchivedResult.rows || allArchivedResult.rows.length === 0) {
        console.log(`[threadService] unarchiveThread: No archived emails found at all`);
        return;
    }

    // Filter by normalized subject in JavaScript for reliability
    const emailIds = allArchivedResult.rows
        .filter((row: any) => normalizeSubject(row.subject || '') === normalizedSubj)
        .map((row: any) => row.message_id);

    if (emailIds.length === 0) {
        console.log(`[threadService] No emails to unarchive in thread ${threadId}`);
        return;
    }

    console.log(`[threadService] Unarchiving ${emailIds.length} emails in thread ${threadId} to ${targetLocation}`);

    // Step 3: Move each email in IMAP
    const failed: string[] = [];
    for (const messageId of emailIds) {
        try {
            await imapService.unarchiveEmail(messageId, targetLocation);
        } catch (err) {
            console.error(`[threadService] Failed to unarchive email ${messageId}:`, err);
            failed.push(messageId);
        }
    }

    // If any failed, throw error
    if (failed.length > 0) {
        throw new Error(`Thread unarchive failed: ${failed.length}/${emailIds.length} emails could not be unarchived`);
    }

    // Step 4: Update database - clear date_archived and set bucket if specified
    const placeholders = emailIds.map(() => '?').join(',');
    if (targetLocation === 'inbox') {
        await db.query(`
            UPDATE email_metadata 
            SET date_archived = NULL, original_bucket = NULL
            WHERE message_id IN (${placeholders})
        `, emailIds);
    } else {
        // targetLocation is a bucket ID
        await db.query(`
            UPDATE email_metadata 
            SET date_archived = NULL, original_bucket = ?
            WHERE message_id IN (${placeholders})
        `, [targetLocation, ...emailIds]);
    }

    console.log(`[threadService] Thread ${threadId} unarchived successfully`);
}

/**
 * Unbucket entire thread (move back to inbox)
 * Removes both the database bucket assignment AND the IMAP bucket labels
 */
export async function unbucketThread(threadId: string): Promise<void> {
    // Get all emails in this thread using normalized_subject matching
    const emailIds = await getThreadEmailIds(threadId);

    if (emailIds.length === 0) {
        console.log(`[threadService] No emails found for thread ${threadId}`);
        return;
    }

    console.log(`[threadService] Unbucketing ${emailIds.length} emails in thread ${threadId}`);

    // Step 1: Remove IMAP bucket labels for each email
    const failed: string[] = [];
    for (const messageId of emailIds) {
        try {
            // assignTags with empty array removes all custom keywords (bucket labels)
            await imapService.assignTags(messageId, []);
        } catch (err) {
            console.error(`[threadService] Failed to remove bucket label from ${messageId}:`, err);
            failed.push(messageId);
        }
    }

    // If any failed, throw error (atomicity)
    if (failed.length > 0) {
        throw new Error(`Thread unbucket failed: ${failed.length}/${emailIds.length} emails could not be unbucketed`);
    }

    // Step 2: Update database only on 100% IMAP success
    const placeholders = emailIds.map(() => '?').join(',');
    await db.query(`
        UPDATE email_metadata 
        SET original_bucket = NULL, date_archived = NULL
        WHERE message_id IN (${placeholders})
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `, emailIds);

    console.log(`[threadService] Unbucketed ${emailIds.length} emails in thread ${threadId} (IMAP + DB)`);
}

/**
 * Backfill thread IDs for existing emails
 */
export async function backfillThreadIds(): Promise<number> {
    const result = await db.query(`
        SELECT message_id, subject, in_reply_to, refs FROM email_metadata
        WHERE thread_id IS NULL
    `);

    if (!result.rows) return 0;

    let updated = 0;
    for (const row of result.rows) {
        const normalizedSubj = normalizeSubject(row.subject || '');
        const threadId = await computeThreadId(
            row.message_id,
            row.in_reply_to,
            row.refs,
            normalizedSubj
        );

        await db.query(`
            UPDATE email_metadata 
            SET thread_id = ?, normalized_subject = ?
            WHERE message_id = ?
        `, [threadId, normalizedSubj, row.message_id]);

        updated++;
    }

    console.log(`[threadService] Backfilled thread_ids for ${updated} emails`);
    return updated;
}

/**
 * Auto-consolidate threads: When new emails arrive in inbox, check if any
 * belong to a thread that has portions in Archive or Buckets.
 * If found, pull those portions back to Inbox to keep the thread together.
 */
export async function autoConsolidateThreads(): Promise<number> {
    console.log('[threadService] Checking for fragmented threads to consolidate...');

    // Step 1: Get all inbox emails (including those without normalized_subject)
    const inboxResult = await db.query(`
        SELECT message_id, subject, normalized_subject FROM email_metadata
        WHERE (original_bucket IS NULL OR original_bucket = '')
          AND (date_archived IS NULL OR date_archived = '')
          AND subject IS NOT NULL AND subject != ''
          AND (mailbox IS NULL OR mailbox != 'Sent')
    `);

    if (!inboxResult.rows || inboxResult.rows.length === 0) {
        console.log('[threadService] No inbox emails to check for consolidation');
        return 0;
    }

    // Build set of normalized subjects from inbox emails (computing on-the-fly if needed)
    const inboxSubjects = new Set<string>();
    for (const row of inboxResult.rows) {
        const normalizedSubj = row.normalized_subject || normalizeSubject(row.subject || '');
        if (normalizedSubj) {
            inboxSubjects.add(normalizedSubj);

            // Also update the DB if normalized_subject was missing
            if (!row.normalized_subject && normalizedSubj) {
                await db.query(`UPDATE email_metadata SET normalized_subject = ? WHERE message_id = ?`, [normalizedSubj, row.message_id]);
            }
        }
    }

    console.log(`[threadService] Found ${inboxSubjects.size} unique thread subjects in inbox`);

    let consolidated = 0;

    // Step 2: For each subject, check if there are archived emails with same subject
    for (const subject of inboxSubjects) {
        // Check archived - also compute normalized_subject on-the-fly
        const archivedResult = await db.query(`
            SELECT message_id, subject, normalized_subject FROM email_metadata
            WHERE date_archived IS NOT NULL AND date_archived != ''
              AND (mailbox IS NULL OR mailbox != 'Sent')
        `);

        const matchingArchived = (archivedResult.rows || []).filter((row: any) => {
            const ns = row.normalized_subject || normalizeSubject(row.subject || '');
            return ns === subject;
        });

        if (matchingArchived.length > 0) {
            console.log(`[threadService] Found ${matchingArchived.length} archived emails for thread "${subject}", pulling back to inbox`);

            for (const row of matchingArchived) {
                try {
                    await imapService.unarchiveEmail(row.message_id, 'INBOX');
                    await db.query(`
                        UPDATE email_metadata 
                        SET date_archived = NULL, original_bucket = NULL, normalized_subject = ?
                        WHERE message_id = ?
                    `, [subject, row.message_id]);
                    consolidated++;
                } catch (err) {
                    console.error(`[threadService] Failed to consolidate email ${row.message_id}:`, err);
                }
            }
        }

        // Step 3: Check if there are bucketed emails with same subject
        const bucketedResult = await db.query(`
            SELECT message_id, subject, normalized_subject FROM email_metadata
            WHERE original_bucket IS NOT NULL AND original_bucket != ''
              AND (date_archived IS NULL OR date_archived = '')
              AND (mailbox IS NULL OR mailbox != 'Sent')
        `);

        const matchingBucketed = (bucketedResult.rows || []).filter((row: any) => {
            const ns = row.normalized_subject || normalizeSubject(row.subject || '');
            return ns === subject;
        });

        if (matchingBucketed.length > 0) {
            console.log(`[threadService] Found ${matchingBucketed.length} bucketed emails for thread "${subject}", pulling back to inbox`);

            for (const row of matchingBucketed) {
                try {
                    // Remove bucket tags and move back to INBOX
                    await imapService.assignTags(row.message_id, []);
                    await db.query(`
                        UPDATE email_metadata 
                        SET original_bucket = NULL, normalized_subject = ?
                        WHERE message_id = ?
                    `, [subject, row.message_id]);
                    consolidated++;
                } catch (err) {
                    console.error(`[threadService] Failed to unbucket email ${row.message_id}:`, err);
                }
            }
        }
    }

    if (consolidated > 0) {
        console.log(`[threadService] Consolidated ${consolidated} emails back to inbox`);
    }
    return consolidated;
}

/**
 * Get all emails in a specific thread
 * Returns emails in chronological order with full body content
 */
export async function getThreadEmails(threadId: string): Promise<any[]> {
    // First, find the email and get its normalized subject
    const emailResult = await db.query(`
        SELECT message_id, subject, thread_id, normalized_subject FROM email_metadata
        WHERE message_id = ? OR thread_id = ?
        LIMIT 1
    `, [threadId, threadId]);

    if (!emailResult.rows || emailResult.rows.length === 0) {
        console.log(`[threadService] getThreadEmails: No email found for ${threadId}`);
        return [];
    }

    const email = emailResult.rows[0];
    const normalizedSubj = email.normalized_subject || normalizeSubject(email.subject || '');

    console.log(`[threadService] getThreadEmails: Looking for thread with subject "${normalizedSubj}"`);

    if (!normalizedSubj) {
        // No subject to match on, return just this email
        const singleResult = await db.query(`
            SELECT 
                message_id as messageId,
                uid,
                subject,
                sender,
                sender_address as senderAddress,
                date,
                preview,
                body_html as bodyHtml,
                body_text as bodyText,
                mailbox,
                notes as note,
                due_date as dueDate
            FROM email_metadata
            WHERE message_id = ?
        `, [email.message_id]);
        return singleResult.rows || [];
    }

    // Find ALL emails with matching normalized subject (across all locations)
    const allEmails = await db.query(`
        SELECT 
            message_id as messageId,
            uid,
            subject,
            sender,
            sender_address as senderAddress,
            date,
            preview,
            body_html as bodyHtml,
            body_text as bodyText,
            mailbox,
            notes as note,
            due_date as dueDate
        FROM email_metadata
        ORDER BY date ASC
    `);

    if (!allEmails.rows || allEmails.rows.length === 0) {
        return [];
    }

    // Filter by normalized subject in JavaScript
    const matchingEmails = allEmails.rows.filter((row: { subject: string }) =>
        normalizeSubject(row.subject || '') === normalizedSubj
    );

    console.log(`[threadService] getThreadEmails: Found ${matchingEmails.length} emails in thread`);

    // Sort by date ascending (chronological)
    matchingEmails.sort((a: { date: string }, b: { date: string }) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return matchingEmails;
}

export const threadService = {
    normalizeSubject,
    computeThreadId,
    getInboxThreads,
    getBucketThreads,
    getArchiveThreads,
    getThreadEmails,
    moveThreadToBucket,
    archiveThread,
    unarchiveThread,
    unbucketThread,
    backfillThreadIds,
    autoConsolidateThreads
};
