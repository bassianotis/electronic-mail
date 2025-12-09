/**
 * Bucket Routes
 * Handles bucket management and fetching emails by bucket
 */
import { Router } from 'express';
import { imapService } from '../services/imapService';
import { db } from '../services/dbService';
import { lastBucketUpdate, invalidateBucketCache } from './inboxRoutes';
import { configService } from '../services/configService';

const router = Router();

const BUCKET_UPDATE_INTERVAL = 60 * 1000; // 60 seconds

// Track last sync time per bucket for throttling
const bucketSyncTimestamps: Map<string, number> = new Map();
const BUCKET_SYNC_INTERVAL = 60 * 1000; // 60 seconds per bucket

// GET /api/buckets - Fetch All Buckets
router.get('/', async (req, res) => {
    try {
        // 1. Serve from DB immediately (Instant Load)
        const result = await db.query('SELECT * FROM buckets ORDER BY sort_order ASC');
        const buckets = result.rows || [];
        res.json(buckets);

        // 2. Background Sync (Fire and Forget)
        const now = Date.now();
        if (now - lastBucketUpdate > BUCKET_UPDATE_INTERVAL) {
            invalidateBucketCache(); // Reset timer
            console.log('Starting background bucket count sync...');

            (async () => {
                if (!configService.isConfigured()) return;

                for (const bucket of buckets) {
                    try {
                        const count = await imapService.countEmailsInBucket(bucket.id);
                        await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, bucket.id]);
                    } catch (err) {
                        console.error(`Error syncing count for bucket ${bucket.id}: `, err);
                    }
                }
                console.log('Background bucket count sync complete.');
            })();
        }
    } catch (err) {
        console.error('Error fetching buckets:', err);
        res.status(500).json({ error: 'Failed to fetch buckets' });
    }
});

// GET /api/buckets/:bucketName/emails - Fetch Emails in a Bucket
// Also handles /api/bucket/:bucketName for backward compatibility
router.get('/:bucketName/emails', fetchBucketEmails);
router.get('/:bucketName', fetchBucketEmails);

async function fetchBucketEmails(req: any, res: any) {
    try {
        const { bucketName } = req.params;

        // Skip if this looks like a CRUD operation path
        if (bucketName === 'reorder') return res.status(404).json({ error: 'Not found' });

        console.log(`📦 [BUCKET] Request for bucket: ${bucketName}`);

        // 1. Check DB cache first
        const dbResult = await db.query(`
            SELECT * FROM email_metadata 
            WHERE original_bucket = ?
            AND date_archived IS NULL
            ORDER BY date DESC
        `, [bucketName]);

        const cachedEmails = (dbResult.rows || []).map((row: any) => ({
            uid: row.uid,
            messageId: row.message_id,
            subject: row.subject,
            from: [{ name: row.sender, address: row.sender_address }],
            date: row.date,
            preview: row.preview || '',
            note: row.notes,

            dueDate: row.due_date,
            bucketId: bucketName // Explicitly set bucketId since we are in a bucket route
        }));

        // 2. If cache has data, return immediately and sync in background
        if (cachedEmails.length > 0) {
            console.log(`📦 [BUCKET] Cache HIT for ${bucketName}: ${cachedEmails.length} emails`);
            res.json(cachedEmails);

            // Background sync if stale
            const now = Date.now();
            const lastSync = bucketSyncTimestamps.get(bucketName) || 0;
            if (now - lastSync > BUCKET_SYNC_INTERVAL && configService.isConfigured()) {
                bucketSyncTimestamps.set(bucketName, now);
                syncBucketToDb(bucketName); // Fire and forget
            }
            return;
        }

        // 3. Cache is empty - fetch from IMAP directly (blocking)
        if (configService.isConfigured()) {
            console.log(`📦 [BUCKET] Cache MISS for ${bucketName}, fetching from IMAP...`);
            bucketSyncTimestamps.set(bucketName, Date.now());

            try {
                const emails = await imapService.fetchBucketEmails(bucketName);

                // Save to DB for next time
                for (const email of emails) {
                    const senderName = email.from?.[0]?.name || email.from?.[0]?.address || 'Unknown';
                    const senderAddress = email.from?.[0]?.address || '';

                    await db.query(`
                        INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, original_bucket)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(message_id) DO UPDATE SET
                            subject = excluded.subject,
                            sender = excluded.sender,
                            sender_address = excluded.sender_address,
                            date = excluded.date,
                            uid = excluded.uid,
                            original_bucket = excluded.original_bucket
                    `, [
                        email.messageId,
                        email.subject || '(No Subject)',
                        senderName,
                        senderAddress,
                        email.date instanceof Date ? email.date.toISOString() : new Date().toISOString(),
                        email.uid,
                        bucketName
                    ]);
                }

                // Return IMAP results directly
                const formattedEmails = emails.map((email: any) => ({
                    uid: email.uid,
                    messageId: email.messageId,
                    subject: email.subject,
                    from: email.from,
                    date: email.date,
                    preview: '',
                    note: undefined,
                    dueDate: undefined,
                    bucketId: bucketName // Explicitly set bucketId
                }));

                console.log(`Fetched ${emails.length} emails from IMAP for ${bucketName}`);
                res.json(formattedEmails);
                return;
            } catch (err) {
                console.error(`IMAP fetch failed for bucket ${bucketName}:`, err);
            }
        }

        // 4. Fallback: return empty if IMAP not configured or failed
        res.json([]);
    } catch (err) {
        console.error('Error fetching bucket emails:', err);
        res.status(500).json({ error: 'Failed to fetch bucket emails' });
    }
}

// Helper function to sync bucket in background
async function syncBucketToDb(bucketName: string) {
    try {
        console.log(`Background sync for bucket: ${bucketName}`);
        const emails = await imapService.fetchBucketEmails(bucketName);

        for (const email of emails) {
            const senderName = email.from?.[0]?.name || email.from?.[0]?.address || 'Unknown';
            const senderAddress = email.from?.[0]?.address || '';

            await db.query(`
                INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, original_bucket)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    subject = excluded.subject,
                    sender = excluded.sender,
                    sender_address = excluded.sender_address,
                    date = excluded.date,
                    uid = excluded.uid,
                    original_bucket = excluded.original_bucket
            `, [
                email.messageId,
                email.subject || '(No Subject)',
                senderName,
                senderAddress,
                email.date instanceof Date ? email.date.toISOString() : new Date().toISOString(),
                email.uid,
                bucketName
            ]);
        }
        console.log(`Background sync complete for bucket: ${bucketName} (${emails.length} emails)`);
    } catch (err) {
        console.error(`Background sync failed for bucket ${bucketName}:`, err);
    }
}

// POST /api/buckets - Create a Bucket
router.post('/', async (req, res) => {
    try {
        const { id, label, color } = req.body;
        await db.query(
            'INSERT INTO buckets (id, label, color) VALUES (?, ?, ?)',
            [id, label, color]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error creating bucket:', err);
        res.status(500).json({ error: 'Failed to create bucket' });
    }
});

// PUT /api/buckets/reorder - Batch update bucket order (MUST be before /:id)
router.put('/reorder', async (req, res) => {
    try {
        const { buckets } = req.body;

        if (!buckets || !Array.isArray(buckets)) {
            return res.status(400).json({ error: 'Buckets array is required' });
        }

        for (const bucket of buckets) {
            await db.query(
                'UPDATE buckets SET sort_order = ? WHERE id = ?',
                [bucket.sort_order, bucket.id]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error reordering buckets:', err);
        res.status(500).json({ error: 'Failed to reorder buckets' });
    }
});

// PUT /api/buckets/:id - Update a Bucket
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { label, color } = req.body;
        await db.query(
            'UPDATE buckets SET label = ?, color = ? WHERE id = ?',
            [label, color, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating bucket:', err);
        res.status(500).json({ error: 'Failed to update bucket' });
    }
});

// DELETE /api/buckets/:id - Delete a Bucket
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM buckets WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting bucket:', err);
        res.status(500).json({ error: 'Failed to delete bucket' });
    }
});

export default router;
