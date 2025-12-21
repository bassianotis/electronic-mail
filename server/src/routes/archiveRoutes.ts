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
        console.log('[ARCHIVE] Request received');

        // 1. Fetch from DB (Cache First)
        // Exclude Sent folder emails since they stay in Sent (not moved to Archives)
        const dbResult = await db.query(`
            SELECT * FROM email_metadata 
            WHERE (date_archived IS NOT NULL)
              AND (mailbox IS NULL OR mailbox != 'Sent')
            ORDER BY date DESC
        `);

        const cachedEmails = (dbResult.rows || []).map((row: any) => ({
            uid: row.uid,
            messageId: row.message_id,
            subject: row.subject,
            from: [{ name: row.sender, address: row.sender_address }],
            date: row.date,
            preview: row.preview || '',
            note: row.notes,
            dueDate: row.due_date,
            originalBucket: row.original_bucket,
            dateArchived: row.date_archived
        }));

        res.json(cachedEmails);

        // 2. Background Sync
        (async () => {
            try {
                const imapEmails = await imapService.fetchArchivedEmails();
                console.log(`[ARCHIVE] Background sync found ${imapEmails.length} emails`);

                // Upsert into DB
                for (const email of imapEmails) {
                    const senderName = email.from?.[0]?.name || email.from?.[0]?.address || 'Unknown';
                    const senderAddress = email.from?.[0]?.address || '';

                    // Only set date_archived for emails NOT currently in INBOX or Sent (to avoid overwriting unarchived/sent emails)
                    // Also set mailbox='Archives' to track folder state
                    await db.query(`
                        INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, date_archived, mailbox)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'Archives')
                        ON CONFLICT(message_id) DO UPDATE SET
                             uid = excluded.uid,
                             date_archived = CASE 
                                 WHEN email_metadata.mailbox = 'INBOX' THEN email_metadata.date_archived  -- Don't overwrite if in INBOX
                                 WHEN email_metadata.mailbox = 'Sent' THEN NULL  -- Sent emails should never have date_archived
                                 ELSE COALESCE(email_metadata.date_archived, excluded.date_archived)
                             END,
                             mailbox = CASE
                                 WHEN email_metadata.mailbox = 'INBOX' THEN 'INBOX'  -- Don't change mailbox if in INBOX
                                 WHEN email_metadata.mailbox = 'Sent' THEN 'Sent'  -- Don't change mailbox if in Sent
                                 ELSE 'Archives'
                             END
                    `, [
                        email.messageId,
                        email.subject,
                        senderName,
                        senderAddress,
                        email.date instanceof Date ? email.date.toISOString() : new Date().toISOString(),
                        email.uid,
                        new Date().toISOString() // Default archive date if new
                    ]);
                }
            } catch (err) {
                console.error('[ARCHIVE] Background sync failed:', err);
            }
        })();

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
