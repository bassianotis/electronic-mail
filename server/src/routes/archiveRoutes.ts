/**
 * Archive Routes
 * Handles archiving, fetching archived emails, and unarchiving
 */
import { Router } from 'express';
import { imapService } from '../services/imapService';
import { db } from '../services/dbService';
import { invalidateBucketCache } from './inboxRoutes';

const router = Router();

// GET /api/archive - Fetch Archived Emails
router.get('/', async (req, res) => {
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

        const debugLog = enrichedEmails.map(e => ({ id: e.messageId, originalBucket: e.originalBucket }));
        console.log('[BACKEND] Fetching archived emails. Samples:', JSON.stringify(debugLog.slice(0, 3)));

        res.json(enrichedEmails);
    } catch (err) {
        console.error('Error fetching archived emails:', err);
        res.status(500).json({ error: 'Failed to fetch archived emails' });
    }
});

// POST /api/archive/:messageId - Archive an Email
router.post('/:messageId', async (req, res) => {
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

        // Update bucket count
        if (bucketId) {
            try {
                const count = await imapService.countEmailsInBucket(bucketId);
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, bucketId]);
            } catch (err) {
                console.error(`Error updating count for bucket ${bucketId}:`, err);
            }
        }

        invalidateBucketCache();
        res.json({ success: true });
    } catch (err) {
        console.error('Error archiving email:', err);
        res.status(500).json({ error: 'Failed to archive email' });
    }
});

// POST /api/archive/:messageId/unarchive - Unarchive Email
router.post('/:messageId/unarchive', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { targetLocation } = req.body; // 'inbox' or bucket name

        // Unarchive in IMAP
        const unarchivedEmail = await imapService.unarchiveEmail(decodedId, targetLocation);

        // Update DB metadata (Upsert to ensure it exists)
        const senderName = unarchivedEmail.from?.[0]?.name || unarchivedEmail.from?.[0]?.address || 'Unknown';
        const senderAddress = unarchivedEmail.from?.[0]?.address || '';

        if (targetLocation === 'inbox') {
            await db.query(`
                INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, date_archived, original_bucket)
                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT(message_id) DO UPDATE SET
                    date_archived = NULL,
                    original_bucket = NULL,
                    subject = excluded.subject,
                    sender = excluded.sender,
                    sender_address = excluded.sender_address,
                    date = excluded.date,
                    uid = excluded.uid
            `, [
                decodedId,
                unarchivedEmail.subject || '(No Subject)',
                senderName,
                senderAddress,
                unarchivedEmail.date instanceof Date ? unarchivedEmail.date.toISOString() : new Date().toISOString(),
                unarchivedEmail.uid
            ]);

            // Force IMAP refresh so email appears in inbox immediately
            try {
                console.log('Refreshing inbox after unarchive...');
                await imapService.fetchTriageEmails();
            } catch (err) {
                console.error('Error refreshing inbox after unarchive:', err);
            }
        } else {
            await db.query(`
                INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, date_archived, original_bucket)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    date_archived = NULL,
                    original_bucket = excluded.original_bucket,
                    subject = excluded.subject,
                    sender = excluded.sender,
                    sender_address = excluded.sender_address,
                    date = excluded.date,
                    uid = excluded.uid
            `, [
                decodedId,
                unarchivedEmail.subject || '(No Subject)',
                senderName,
                senderAddress,
                unarchivedEmail.date instanceof Date ? unarchivedEmail.date.toISOString() : new Date().toISOString(),
                unarchivedEmail.uid,
                targetLocation
            ]);
        }

        // Update bucket count
        if (targetLocation && targetLocation !== 'inbox') {
            try {
                const count = await imapService.countEmailsInBucket(targetLocation);
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [count, targetLocation]);
            } catch (err) {
                console.error(`Error updating count for bucket ${targetLocation}:`, err);
            }
        }

        invalidateBucketCache();
        res.json({ success: true, messageId: unarchivedEmail.messageId });
    } catch (err) {
        console.error('Error unarchiving email:', err);
        res.status(500).json({ error: 'Failed to unarchive email' });
    }
});

export default router;
