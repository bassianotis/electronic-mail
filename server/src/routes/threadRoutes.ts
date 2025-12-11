/**
 * Thread Routes
 * API endpoints for thread-related operations
 */
import { Router, Request, Response } from 'express';
import { threadService } from '../services/threadService';
import { imapService } from '../services/imapService';

const router = Router();

/**
 * GET /api/threads/inbox
 * Get all threads for the inbox view (unbucketed or resurfaced)
 */
router.get('/inbox', async (req: Request, res: Response) => {
    try {
        const threads = await threadService.getThreadedEmails('inbox');
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (error) {
        console.error('Error fetching inbox threads:', error);
        res.status(500).json({ error: 'Failed to fetch inbox threads' });
    }
});

/**
 * GET /api/threads/bucket/:bucketId
 * Get all threads for a specific bucket
 */
router.get('/bucket/:bucketId', async (req: Request, res: Response) => {
    try {
        const { bucketId } = req.params;
        const threads = await threadService.getThreadedEmails('bucket', bucketId);
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (error) {
        console.error('Error fetching bucket threads:', error);
        res.status(500).json({ error: 'Failed to fetch bucket threads' });
    }
});

/**
 * GET /api/threads/archive
 * Get all threads in the archive
 */
router.get('/archive', async (req: Request, res: Response) => {
    try {
        const threads = await threadService.getThreadedEmails('archive');
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (error) {
        console.error('Error fetching archive threads:', error);
        res.status(500).json({ error: 'Failed to fetch archive threads' });
    }
});

/**
 * POST /api/threads/:threadId/bucket
 * Move an entire thread to a bucket
 */
router.post('/:threadId/bucket', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        const { bucketId } = req.body;

        if (!bucketId) {
            return res.status(400).json({ error: 'bucketId is required' });
        }

        await threadService.moveThreadToBucket(threadId, bucketId);

        // Also update IMAP flags for all emails in the thread
        // This is done asynchronously to not block the response
        // TODO: Implement IMAP tag update for thread

        res.json({ success: true, threadId, bucketId });
    } catch (error) {
        console.error('Error moving thread to bucket:', error);
        res.status(500).json({ error: 'Failed to move thread to bucket' });
    }
});

/**
 * POST /api/threads/:threadId/return
 * Return a resurfaced thread to its original bucket
 */
router.post('/:threadId/return', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        await threadService.returnThreadToBucket(threadId);
        res.json({ success: true, threadId });
    } catch (error) {
        console.error('Error returning thread to bucket:', error);
        res.status(500).json({ error: 'Failed to return thread to bucket' });
    }
});

/**
 * POST /api/threads/:threadId/archive
 * Archive an entire thread
 */
router.post('/:threadId/archive', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        await threadService.archiveThread(threadId);
        res.json({ success: true, threadId });
    } catch (error) {
        console.error('Error archiving thread:', error);
        res.status(500).json({ error: 'Failed to archive thread' });
    }
});

/**
 * POST /api/threads/:threadId/unarchive
 * Restore an entire thread from archive to inbox or a bucket
 * Body: { targetLocation: 'inbox' | bucketId }
 */
router.post('/:threadId/unarchive', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        const { targetLocation } = req.body;
        console.log(`[ThreadRoutes] Unarchiving thread ${threadId} to ${targetLocation}`);

        const result = await threadService.unarchiveThread(threadId, targetLocation || 'inbox');
        res.json({ success: true, threadId, ...result });
    } catch (error) {
        console.error('Error unarchiving thread:', error);
        res.status(500).json({ error: 'Failed to unarchive thread' });
    }
});

/**
 * POST /api/threads/:threadId/unbucket
 * Move an entire thread back to inbox (unbucket)
 */
router.post('/:threadId/unbucket', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        console.log(`[ThreadRoutes] Unbucketing thread ${threadId}`);
        await threadService.unbucketThread(threadId);
        res.json({ success: true, threadId });
    } catch (error) {
        console.error('Error unbucketing thread:', error);
        res.status(500).json({ error: 'Failed to unbucket thread' });
    }
});

/**
 * POST /api/threads/:threadId/consolidate
 * Consolidate a fragmented thread - move ALL emails to a single location
 * Body: { target: 'archive' | 'inbox' }
 */
router.post('/:threadId/consolidate', async (req: Request, res: Response) => {
    try {
        const { threadId } = req.params;
        const { target } = req.body; // 'archive' or 'inbox'

        if (!target || (target !== 'archive' && target !== 'inbox')) {
            return res.status(400).json({ error: 'target must be "archive" or "inbox"' });
        }

        console.log(`[ThreadRoutes] Consolidating thread ${threadId} to ${target}`);

        const result = await threadService.consolidateThread(threadId, target);
        res.json({
            success: true,
            threadId,
            target,
            ...result
        });
    } catch (error) {
        console.error('Error consolidating thread:', error);
        res.status(500).json({ error: 'Failed to consolidate thread' });
    }
});

/**
 * POST /api/threads/sync-sent
 * Trigger a sync of sent emails for threading
 */
router.post('/sync-sent', async (req: Request, res: Response) => {
    try {
        const sentEmails = await imapService.fetchSentEmails();
        res.json({
            success: true,
            count: sentEmails.length,
            message: `Synced ${sentEmails.length} sent emails`
        });
    } catch (error) {
        console.error('Error syncing sent emails:', error);
        res.status(500).json({ error: 'Failed to sync sent emails' });
    }
});

/**
 * POST /api/threads/backfill
 * Backfill thread IDs for existing emails (admin/maintenance endpoint)
 */
router.post('/backfill', async (req: Request, res: Response) => {
    try {
        const updated = await threadService.backfillThreadIds();
        res.json({
            success: true,
            updated,
            message: `Backfilled thread IDs for ${updated} emails`
        });
    } catch (error) {
        console.error('Error backfilling thread IDs:', error);
        res.status(500).json({ error: 'Failed to backfill thread IDs' });
    }
});

/**
 * POST /api/threads/sync-archive
 * Sync database with IMAP Archive folder - ensures date_archived is set for all archived emails
 * Creates new records for emails not in DB with full metadata
 */
router.post('/sync-archive', async (req: Request, res: Response) => {
    try {
        const { imapService } = await import('../services/imapService');
        const { db } = await import('../services/dbService');

        // Fetch all emails from IMAP Archive folder
        const archivedEmails = await imapService.fetchArchivedEmails();
        console.log(`[sync-archive] Found ${archivedEmails.length} emails in IMAP Archive`);

        const now = new Date().toISOString();
        let inserted = 0;
        let updated = 0;

        for (const email of archivedEmails) {
            if (!email.messageId) continue;

            // Get sender info
            const senderName = email.from?.[0]?.name || email.from?.[0]?.address || 'Unknown';
            const senderAddress = email.from?.[0]?.address || '';

            // Parse date safely with fallback
            let emailDate = now;
            try {
                if (email.date instanceof Date && !isNaN(email.date.getTime())) {
                    emailDate = email.date.toISOString();
                } else if (email.date) {
                    const parsed = new Date(email.date);
                    if (!isNaN(parsed.getTime())) {
                        emailDate = parsed.toISOString();
                    }
                }
            } catch (e) {
                console.log(`[sync-archive] Invalid date for ${email.messageId}, using now`);
            }

            // Use UPSERT to create or update
            const result = await db.query(
                `INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, date_archived)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(message_id) DO UPDATE SET
                     date_archived = COALESCE(email_metadata.date_archived, excluded.date_archived),
                     subject = COALESCE(email_metadata.subject, excluded.subject),
                     sender = COALESCE(email_metadata.sender, excluded.sender),
                     sender_address = COALESCE(email_metadata.sender_address, excluded.sender_address),
                     date = COALESCE(email_metadata.date, excluded.date),
                     uid = COALESCE(email_metadata.uid, excluded.uid)`,
                [email.messageId, email.subject || '(No Subject)', senderName, senderAddress, emailDate, email.uid, now]
            );

            // Check if it was an insert or update based on changes
            if (result.rowCount && result.rowCount > 0) {
                // Simple heuristic: cannot easily distinguish, count all as processed
                updated++;
            }
        }

        console.log(`[sync-archive] Processed ${updated} archived emails`);

        // Also run backfill to ensure thread_ids are set
        const threadUpdated = await threadService.backfillThreadIds();

        res.json({
            success: true,
            archivedEmailsFound: archivedEmails.length,
            emailsProcessed: updated,
            threadIdsBackfilled: threadUpdated,
            message: `Synced ${archivedEmails.length} archived emails, backfilled ${threadUpdated} thread IDs`
        });
    } catch (error) {
        console.error('Error syncing archive:', error);
        res.status(500).json({ error: 'Failed to sync archive' });
    }
});

export default router;
