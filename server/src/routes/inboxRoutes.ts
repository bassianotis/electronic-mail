/**
 * Inbox Routes
 * Handles inbox email fetching and synchronization
 */
import { Router } from 'express';
import { imapService } from '../services/imapService';
import { db } from '../services/dbService';
import { configService } from '../services/configService';

const router = Router();

// Export for bucket routes to invalidate
export let lastBucketUpdate = 0;
export const invalidateBucketCache = () => {
    lastBucketUpdate = 0;
};

// GET /api/inbox - Fetch Triage Emails
router.get('/', async (req, res) => {
    try {
        console.log('📬 [INBOX] Request received');

        // 1. Serve from DB immediately (Instant Load)
        const dbResult = await db.query(`
            SELECT * FROM email_metadata 
            WHERE original_bucket IS NULL 
            AND date_archived IS NULL
            AND date IS NOT NULL
            AND date > '2000-01-01'
            ORDER BY date DESC
        `);

        const dbEmails = (dbResult.rows || []).map((row: any) => ({
            uid: row.uid,
            messageId: row.message_id,
            subject: row.subject,
            from: [{ name: row.sender, address: row.sender_address }],
            date: row.date,
            preview: row.preview,
            notes: row.notes,
            dueDate: row.due_date
        }));

        console.log(`📬 [INBOX] Returning ${dbEmails.length} emails from DB cache`);
        res.json(dbEmails);

        // NOTE: Background sync on every request disabled to reduce IMAP lock contention.
        // The 5-minute sync worker (syncWorker.ts) handles syncing instead.
        // This allows body fetches to proceed without waiting for 14k email scans.

    } catch (err) {
        console.error('Error fetching inbox:', err);
        res.status(500).json({ error: 'Failed to fetch inbox' });
    }
});

// POST /api/inbox/sync - Trigger immediate inbox sync
router.post('/sync', async (req, res) => {
    try {
        // Skip if IMAP not configured
        if (!configService.isConfigured()) {
            return res.json({ success: true, message: 'IMAP not configured' });
        }

        const waitForSync = req.query.wait === 'true';
        console.log(`🔄 Manual sync triggered (wait=${waitForSync})`);

        const syncPromise = (async () => {
            try {
                await imapService.fetchTriageEmails();
                console.log('✓ Manual sync complete');
            } catch (err) {
                console.error('✗ Manual sync failed:', err);
                throw err;
            }
        })();

        if (waitForSync) {
            await syncPromise;
            res.json({ success: true, message: 'Sync complete' });
        } else {
            res.json({ success: true, message: 'Sync started' });
        }
    } catch (err: any) {
        console.error('Error triggering sync:', err);
        res.status(500).json({ error: 'Failed to trigger sync: ' + err.message });
    }
});

export default router;
