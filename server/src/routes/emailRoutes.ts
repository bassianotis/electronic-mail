import { Router } from 'express';
import { imapService } from '../services/imapService';
import { db, getDb } from '../services/dbService';
import { configService } from '../services/configService';

const router = Router();

router.get('/health', (req, res) => {
    res.send('OK');
});

// POST /api/sync - Trigger immediate inbox sync (bypasses throttling)
router.post('/sync', async (req, res) => {
    try {
        // Check if IMAP is configured
        if (!configService.isConfigured()) {
            res.json({ success: false, message: 'IMAP not configured. Please complete setup.' });
            return;
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
            // Fire-and-forget
            res.json({ success: true, message: 'Sync started' });
        }
    } catch (err: any) {
        console.error('Error triggering sync:', err);
        res.status(500).json({ error: 'Failed to trigger sync: ' + err.message });
    }
});

// In-memory timestamp for inbox sync
let lastInboxUpdate = 0;
const INBOX_UPDATE_INTERVAL = 60 * 1000;

// In-memory timestamp to throttle background updates (not data)
let lastBucketUpdate = 0;
const BUCKET_UPDATE_INTERVAL = 60 * 1000; // 60 seconds

// 1. GET /api/inbox - Fetch Triage Emails
router.get('/inbox', async (req, res) => {
    try {
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

        res.json(dbEmails);

        // 2. Background Sync (Fire and Forget)
        const now = Date.now();
        // Sync if interval passed OR if DB is empty (first run)
        if (now - lastInboxUpdate > INBOX_UPDATE_INTERVAL || dbEmails.length === 0) {
            lastInboxUpdate = now;
            console.log('Starting background inbox sync...');

            (async () => {
                try {
                    // Fetch from IMAP (upserts to DB)
                    const emails = await imapService.fetchTriageEmails();

                    // 2. Fetch all rules
                    const rules = await getDb().all('SELECT * FROM email_rules');

                    // 3. Apply rules to each email (auto-bucket if match found)
                    console.log(`Processing ${emails.length} emails for rule matching...`);
                    for (const email of emails) {
                        // Check if already processed
                        const metaRes = await db.query(
                            'SELECT rules_processed FROM email_metadata WHERE message_id = ?',
                            [email.messageId]
                        );

                        if (metaRes.rows && metaRes.rows[0] && metaRes.rows[0].rules_processed) {
                            continue; // Already processed, skip
                        }

                        const senderEmail = email.from && email.from[0] ? email.from[0].address : '';

                        // Check if sender matches any rule
                        const matchingRule = rules.find((rule: any) =>
                            rule.sender_pattern.toLowerCase() === (senderEmail || '').toLowerCase()
                        );

                        if (matchingRule) {
                            // Auto-bucket this email
                            console.log(`RULE MATCH! Email ${email.messageId} matches rule for ${matchingRule.sender_pattern} -> bucket ${matchingRule.bucket_id}`);
                            try {
                                await imapService.assignTags(email.messageId, [matchingRule.bucket_id, '$bucketed']);
                                console.log(`✓ Auto-bucketed email ${email.messageId} to ${matchingRule.bucket_id}`);

                                // Invalidate bucket count cache since counts changed
                                lastBucketUpdate = 0;
                            } catch (err) {
                                console.error(`✗ Failed to auto-bucket email ${email.uid}:`, err);
                            }
                        }

                        // Mark as processed
                        await db.query(`
                            UPDATE email_metadata 
                            SET rules_processed = 1
                            WHERE message_id = ?
                        `, [email.messageId]);
                    }

                    console.log('Background inbox sync complete.');
                } catch (err) {
                    console.error('Background inbox sync failed:', err);
                }
            })();
        }
    } catch (err) {
        console.error('Error fetching inbox:', err);
        res.status(500).json({ error: 'Failed to fetch inbox' });
    }
});


// 2. GET /api/emails/:messageId - Fetch Single Email Body
router.get('/emails/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { uid } = req.query; // Get UID from query params
        // Decode if it was URL encoded (though usually express handles this)
        const decodedId = decodeURIComponent(messageId);

        // Pass UID to fetchEmail for optimization
        const content = await imapService.fetchEmail(decodedId, uid as string);
        res.json(content);
    } catch (err) {
        console.error('Error fetching email body:', err);
        res.status(500).json({ error: 'Failed to fetch email body' });
    }
});

// 2b. GET /api/emails/:messageId/attachments/:index - Download Attachment
router.get('/emails/:messageId/attachments/:index', async (req, res) => {
    try {
        const { messageId, index } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const attachmentIndex = parseInt(index, 10);

        const content = await imapService.fetchEmail(decodedId);

        if (!content.attachments || attachmentIndex >= content.attachments.length) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = content.attachments[attachmentIndex];

        res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename = "${attachment.filename}"`);
        res.send(attachment.content);
    } catch (err) {
        console.error('Error downloading attachment:', err);
        res.status(500).json({ error: 'Failed to download attachment' });
    }
});

// 3. GET /api/bucket/:bucketName - Fetch Bucket Emails
router.get('/bucket/:bucketName', async (req, res) => {
    try {
        const { bucketName } = req.params;
        const emails = await imapService.fetchBucketEmails(bucketName);

        // Fetch metadata for these emails
        const messageIds = emails.map(e => e.messageId).filter(Boolean);
        let metadataMap = new Map();

        if (messageIds.length > 0) {
            const placeholders = messageIds.map(() => '?').join(',');
            const result = await db.query(`
SELECT * FROM email_metadata WHERE message_id IN(${placeholders})
    `, messageIds);

            const metadata = result.rows || [];
            metadata.forEach((m: any) => metadataMap.set(m.message_id, m));
        }

        // Merge metadata
        const enrichedEmails = emails.map(email => {
            const meta = metadataMap.get(email.messageId);
            return {
                ...email,
                note: meta?.notes,
                dueDate: meta?.due_date,
                preview: meta?.preview || ''
            };
        });

        res.json(enrichedEmails);
    } catch (err) {
        console.error('Error fetching bucket emails:', err);
        res.status(500).json({ error: 'Failed to fetch bucket emails' });
    }
});

// 3. POST /api/emails/:messageId/bucket - Assign Email to Buckets
router.post('/emails/:messageId/bucket', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { tags } = req.body; // Expecting { tags: string[] }

        if (!tags || !Array.isArray(tags)) {
            return res.status(400).json({ error: 'Tags array is required' });
        }

        // Check if this is an unbucketing operation (moving to inbox)
        const isUnbucketing = tags.length === 0;

        // If unbucketing, get the current bucket so we can update its count
        let sourceBucketId: string | null = null;
        if (isUnbucketing) {
            const metaResult = await db.query(
                'SELECT original_bucket FROM email_metadata WHERE message_id = ?',
                [decodedId]
            );
            sourceBucketId = metaResult.rows?.[0]?.original_bucket || null;
        }

        // Assign IMAP tags
        await imapService.assignTags(decodedId, tags);

        // Extract the primary bucket ID (first non-$bucketed tag)
        const bucketId = tags.find(tag => tag !== '$bucketed');

        // Update email_metadata
        if (isUnbucketing) {
            // Clear original_bucket to move email back to inbox
            await db.query(`
                UPDATE email_metadata 
                SET original_bucket = NULL 
                WHERE message_id = ?
            `, [decodedId]);
        } else if (bucketId) {
            // Set original_bucket to mark as bucketed
            await db.query(`
                INSERT INTO email_metadata(message_id, original_bucket)
                VALUES(?, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    original_bucket = excluded.original_bucket
            `, [decodedId, bucketId]);
        }

        // Check if email is being moved to "today" bucket
        const isTodayBucket = tags.some(tag => tag.toLowerCase() === 'today');

        if (isTodayBucket) {
            // Get today's date in ET timezone
            const now = new Date();
            const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const noonET = new Date(etNow);
            noonET.setHours(12, 0, 0, 0);

            await db.query(`
                INSERT INTO email_metadata(message_id, due_date, original_bucket)
                VALUES(?, ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    due_date = excluded.due_date,
                    original_bucket = excluded.original_bucket
            `, [decodedId, noonET.toISOString(), bucketId]);
        }

        // Immediately update bucket count for instant UI feedback
        const affectedBucketId = isUnbucketing ? sourceBucketId : bucketId;
        if (affectedBucketId) {
            try {
                const count = await imapService.countEmailsInBucket(affectedBucketId);
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, affectedBucketId]);
            } catch (err) {
                console.error(`Error updating count for bucket ${affectedBucketId}:`, err);
            }
        }

        // Invalidate cache to refresh other buckets in background
        lastBucketUpdate = 0;

        res.json({ success: true });
    } catch (err) {
        console.error('Error assigning tags:', err);
        res.status(500).json({ error: 'Failed to assign tags' });
    }
});

// 3b. POST /api/emails/:messageId/mark-read - Mark Email as Read
router.post('/emails/:messageId/mark-read', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { uid } = req.query; // Check for UID in query params
        const decodedId = decodeURIComponent(messageId);

        console.log(`Mark-as-read request - messageId: ${decodedId}, uid: ${uid}`);

        // Use UID-based marking if available, otherwise fall back to Message-ID search
        if (uid) {
            console.log(`Using UID-based marking for UID: ${uid}`);
            await imapService.markAsReadByUid(parseInt(uid as string), decodedId);
        } else {
            console.log(`Using Message-ID search for: ${decodedId}`);
            await imapService.markAsRead(decodedId);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error marking as read:', err);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
});

// 4. PUT /api/emails/metadata - Add/Update Notes, Due Date, and Preview
router.put('/emails/metadata', async (req, res) => {
    try {
        const { messageId, notes, dueDate, preview } = req.body;

        if (!messageId) {
            return res.status(400).json({ error: 'messageId is required' });
        }

        // Check if metadata exists
        const existing = await db.query('SELECT 1 FROM email_metadata WHERE message_id = ?', [messageId]);
        const exists = existing.rows && existing.rows.length > 0;

        if (exists) {
            // UPDATE existing record
            const fields: string[] = [];
            const values: any[] = [];

            if (notes !== undefined) {
                fields.push('notes = ?');
                values.push(notes);
            }
            if (dueDate !== undefined) {
                fields.push('due_date = ?');
                values.push(dueDate);
            }
            if (preview !== undefined) {
                fields.push('preview = ?');
                values.push(preview);
            }

            if (fields.length === 0) {
                return res.status(400).json({ error: 'No fields to update' });
            }

            values.push(messageId); // Add messageId for WHERE clause

            const query = `UPDATE email_metadata SET ${fields.join(', ')} WHERE message_id = ?`;
            await db.query(query, values);

        } else {
            // INSERT new record
            const fields: string[] = ['message_id'];
            const placeholders: string[] = ['?'];
            const values: any[] = [messageId];

            if (notes !== undefined) {
                fields.push('notes');
                placeholders.push('?');
                values.push(notes);
            }
            if (dueDate !== undefined) {
                fields.push('due_date');
                placeholders.push('?');
                values.push(dueDate);
            }
            if (preview !== undefined) {
                fields.push('preview');
                placeholders.push('?');
                values.push(preview);
            }

            const query = `INSERT INTO email_metadata (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
            await db.query(query, values);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating metadata:', err);
        res.status(500).json({ error: 'Failed to update metadata' });
    }
});

// 5. POST /api/emails/:messageId/archive - Archive an Email
router.post('/emails/:messageId/archive', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { bucketId } = req.body;

        // Archive the email in IMAP
        await imapService.archiveEmail(decodedId);

        // Save archive metadata to DB
        const now = new Date().toISOString();
        await db.query(`
            UPDATE email_metadata 
            SET date_archived = ?, original_bucket = ?
    WHERE message_id = ?
        `, [now, bucketId || null, decodedId]);

        // If no existing metadata row, insert one
        await db.query(`
            INSERT OR IGNORE INTO email_metadata(message_id, date_archived, original_bucket)
VALUES(?, ?, ?)
    `, [decodedId, now, bucketId || null]);

        // Immediately update bucket count for instant UI feedback
        if (bucketId) {
            try {
                const count = await imapService.countEmailsInBucket(bucketId);
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, bucketId]);
            } catch (err) {
                console.error(`Error updating count for bucket ${bucketId}:`, err);
            }
        }

        // Invalidate cache to refresh other buckets
        lastBucketUpdate = 0;

        res.json({ success: true });
    } catch (err) {
        console.error('Error archiving email:', err);
        res.status(500).json({ error: 'Failed to archive email' });
    }
});

// 6. GET /api/archive - Fetch Archived Emails
router.get('/archive', async (req, res) => {
    try {
        const emails = await imapService.fetchArchivedEmails();

        // Fetch metadata for these emails
        const messageIds = emails.map(e => e.messageId).filter(Boolean);
        let metadataMap = new Map();

        if (messageIds.length > 0) {
            const placeholders = messageIds.map(() => '?').join(',');
            const result = await db.query(`
SELECT * FROM email_metadata WHERE message_id IN(${placeholders})
    `, messageIds);

            const metadata = result.rows || [];
            metadata.forEach((m: any) => metadataMap.set(m.message_id, m));
        }

        // Merge metadata
        const enrichedEmails = emails.map(email => {
            const meta = metadataMap.get(email.messageId);
            return {
                ...email,
                note: meta?.notes,
                dueDate: meta?.due_date,
                originalBucket: meta?.original_bucket,
                preview: meta?.preview || ''
            };
        });

        res.json(enrichedEmails);
    } catch (err) {
        console.error('Error fetching archived emails:', err);
        res.status(500).json({ error: 'Failed to fetch archived emails' });
    }
});

// 7. POST /api/emails/:messageId/unarchive - Unarchive Email
router.post('/emails/:messageId/unarchive', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { targetLocation } = req.body; // 'inbox' or bucket name

        // Unarchive in IMAP
        const returnedMessageId = await imapService.unarchiveEmail(decodedId, targetLocation);

        // Update DB metadata
        if (targetLocation === 'inbox') {
            // Restore to inbox: clear both date_archived and original_bucket
            await db.query(`
                UPDATE email_metadata 
                SET date_archived = NULL, original_bucket = NULL
                WHERE message_id = ?
            `, [decodedId]);
        } else {
            // Restore to bucket: clear date_archived, set original_bucket
            await db.query(`
                UPDATE email_metadata 
                SET date_archived = NULL, original_bucket = ?
                WHERE message_id = ?
            `, [targetLocation, decodedId]);
        }

        // Immediately update bucket count for instant UI feedback
        if (targetLocation && targetLocation !== 'inbox') {
            try {
                const count = await imapService.countEmailsInBucket(targetLocation);
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, targetLocation]);
            } catch (err) {
                console.error(`Error updating count for bucket ${targetLocation}:`, err);
            }
        }

        // Invalidate cache to refresh other buckets
        lastBucketUpdate = 0;

        res.json({ success: true, messageId: returnedMessageId });
    } catch (err) {
        console.error('Error unarchiving email:', err);
        res.status(500).json({ error: 'Failed to unarchive email' });
    }
});

// 6. Bucket Management Endpoints

// GET /api/buckets
router.get('/buckets', async (req, res) => {
    try {
        // 1. Serve from DB immediately (Instant Load)
        const result = await db.query('SELECT * FROM buckets');
        const buckets = result.rows || [];
        res.json(buckets);

        // 2. Background Sync (Fire and Forget)
        const now = Date.now();
        if (now - lastBucketUpdate > BUCKET_UPDATE_INTERVAL) {
            lastBucketUpdate = now;
            console.log('Starting background bucket count sync...');

            // Process in background
            (async () => {
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

// POST /api/buckets
router.post('/buckets', async (req, res) => {
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

// PUT /api/buckets/reorder - Batch update bucket order (MUST be before /buckets/:id)
router.put('/buckets/reorder', async (req, res) => {
    console.log('🔥🔥🔥 REORDER HANDLER CALLED 🔥🔥🔥');
    try {
        const { buckets } = req.body; // Expecting { buckets: Array<{ id: string, sort_order: number }> }

        if (!buckets || !Array.isArray(buckets)) {
            return res.status(400).json({ error: 'Buckets array is required' });
        }

        console.log('!!! RECEIVED REORDER REQUEST !!!');
        console.log('PAYLOAD:', JSON.stringify(buckets, null, 2));

        // Update each bucket's sort_order
        for (const bucket of buckets) {
            console.log(`Updating bucket ${bucket.id} to sort_order ${bucket.sort_order} `);
            const result = await db.query(
                'UPDATE buckets SET sort_order = ? WHERE id = ?',
                [bucket.sort_order, bucket.id]
            );
            console.log(`Update result for ${bucket.id}: `, result);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error reordering buckets:', err);
        res.status(500).json({ error: 'Failed to reorder buckets' });
    }
});

// PUT /api/buckets/:id
router.put('/buckets/:id', async (req, res) => {
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

// DELETE /api/buckets/:id
router.delete('/buckets/:id', async (req, res) => {
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
