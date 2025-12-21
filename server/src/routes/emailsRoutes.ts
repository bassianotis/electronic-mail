/**
 * Email Routes
 * Handles individual email operations: fetching body, attachments, bucketing, marking read, metadata
 */
import { Router } from 'express';
import { imapService } from '../services/imapService';
import { smtpService } from '../services/smtpService';
import { db } from '../services/dbService';
import { invalidateBucketCache } from './inboxRoutes';

const router = Router();

// Track in-flight body fetch requests to prevent duplicate IMAP operations
const inFlightFetches = new Map<string, Promise<any>>();

// POST /api/emails/send - Send an email via SMTP
router.post('/send', async (req, res) => {
    try {
        const { to, cc, bcc, subject, body, inReplyTo, references, attachments } = req.body;

        if (!to || !Array.isArray(to) || to.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one recipient is required' });
        }

        if (!subject) {
            return res.status(400).json({ success: false, error: 'Subject is required' });
        }

        console.log(`[API] Sending email to ${to.join(', ')}...`);

        // Process attachments - convert base64 to Buffer
        const processedAttachments = attachments?.map((att: any) => ({
            filename: att.name || att.filename,
            content: att.content ? Buffer.from(att.content, 'base64') : undefined,
            contentType: att.type || att.contentType
        })).filter((att: any) => att.content);

        const result = await smtpService.sendEmail({
            to,
            cc: cc || [],
            bcc: bcc || [],
            subject,
            html: body,
            inReplyTo,
            references,
            attachments: processedAttachments
        });

        if (result.success) {
            // Cleanup any drafts for this reply (handles optimistic email IDs too)
            if (inReplyTo) {
                try {
                    // Get drafts with their IMAP UIDs before deleting
                    const draftsResult = await db.query('SELECT id, imap_uid FROM drafts WHERE in_reply_to = ?', [inReplyTo]);
                    const drafts = draftsResult.rows || [];

                    for (const draft of drafts) {
                        // Delete from IMAP if we have the UID
                        if (draft.imap_uid) {
                            try {
                                await imapService.deleteDraft(draft.imap_uid);
                            } catch (imapErr) {
                                console.error('[API] IMAP draft delete failed:', imapErr);
                            }
                        }
                    }

                    // Delete all matching drafts from database
                    await db.query('DELETE FROM drafts WHERE in_reply_to = ?', [inReplyTo]);
                } catch (cleanupErr) {
                    console.error('[API] Draft cleanup failed:', cleanupErr);
                    // Don't fail the send if cleanup fails
                }
            }
            res.json({ success: true, messageId: result.messageId });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (err: any) {
        console.error('Error sending email:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to send email' });
    }
});

// GET /api/emails/:messageId - Fetch Single Email Body
router.get('/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { uid } = req.query;
        const decodedId = decodeURIComponent(messageId);

        // 1. Check DB cache first (instant, no IMAP lock needed)
        const cacheResult = await db.query(
            'SELECT body_html, body_text, body_fetched_at FROM email_metadata WHERE message_id = ?',
            [decodedId]
        );

        if (cacheResult.rows && cacheResult.rows[0] && cacheResult.rows[0].body_html && cacheResult.rows[0].body_html.length > 100) {
            console.log(`📨 [BODY] Cache HIT for ${decodedId.substring(0, 30)}`);
            return res.json({
                html: cacheResult.rows[0].body_html,
                text: cacheResult.rows[0].body_text,
                attachments: [] // Attachments not cached, will fetch if requested
            });
        }

        // 2. Check if this email is already being fetched (prevent duplicate IMAP operations)
        if (inFlightFetches.has(decodedId)) {
            console.log(`📨 [BODY] Waiting for in-flight fetch for ${decodedId.substring(0, 30)}`);
            try {
                const content = await inFlightFetches.get(decodedId);
                return res.json(content);
            } catch (err) {
                // The original fetch failed, we'll try again below
                console.log(`📨 [BODY] In-flight fetch failed, retrying for ${decodedId.substring(0, 30)}`);
            }
        }

        // 3. Cache miss - fetch from IMAP (with in-flight tracking)
        console.log(`📨 [BODY] Cache MISS for ${decodedId.substring(0, 30)}, fetching from IMAP...`);

        const fetchPromise = imapService.fetchEmail(decodedId, uid as string);
        inFlightFetches.set(decodedId, fetchPromise);

        try {
            const content = await fetchPromise;

            // 4. Save to DB cache for next time (fire and forget)
            // DON'T cache error messages (they're short like "<p>Error fetching email.</p>")
            if (content && content.html && content.html.length > 100) {
                console.log(`📨 [BODY] Caching body (${content.html.length} chars) for ${decodedId.substring(0, 30)}`);
                db.query(`
                    INSERT INTO email_metadata (message_id, body_html, body_text, body_fetched_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(message_id) DO UPDATE SET
                        body_html = excluded.body_html,
                        body_text = excluded.body_text,
                        body_fetched_at = excluded.body_fetched_at
                `, [
                    decodedId,
                    content.html,
                    content.text || '',
                    new Date().toISOString()
                ]).catch(err => console.error('Error caching email body:', err));
            } else if (content && content.html) {
                console.log(`📨 [BODY] NOT caching short response (${content.html.length} chars) - likely error`);
            }

            res.json(content);
        } finally {
            // Clean up in-flight tracking
            inFlightFetches.delete(decodedId);
        }
    } catch (err) {
        console.error('Error fetching email body:', err);
        res.status(500).json({ error: 'Failed to fetch email body' });
    }
});

// GET /api/emails/:messageId/attachments/:index - Download Attachment
router.get('/:messageId/attachments/:index', async (req, res) => {
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

// POST /api/emails/:messageId/bucket - Assign Email to Buckets
router.post('/:messageId/bucket', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { tags, emailData } = req.body; // emailData includes subject, from, date, uid

        if (!tags || !Array.isArray(tags)) {
            return res.status(400).json({ error: 'Tags array is required' });
        }

        const isUnbucketing = tags.length === 0;
        const bucketId = tags.find(tag => tag !== '$bucketed');

        // If unbucketing, get the current bucket for count update
        let sourceBucketId: string | null = null;
        if (isUnbucketing) {
            const metaResult = await db.query(
                'SELECT original_bucket FROM email_metadata WHERE message_id = ?',
                [decodedId]
            );
            sourceBucketId = metaResult.rows?.[0]?.original_bucket || null;
        }

        // 1. UPDATE DB IMMEDIATELY (optimistic) - UPDATE ENTIRE THREAD
        if (isUnbucketing) {
            // Clear bucket for entire thread
            await db.query(`
                UPDATE email_metadata 
                SET original_bucket = NULL 
                WHERE normalized_subject = (SELECT normalized_subject FROM email_metadata WHERE message_id = ?)
            `, [decodedId]);
        } else if (bucketId) {
            // First, ensure the clicked email has full data
            const senderName = emailData?.from?.[0]?.name || emailData?.from?.[0]?.address || 'Unknown';
            const senderAddress = emailData?.from?.[0]?.address || '';

            await db.query(`
                INSERT INTO email_metadata(message_id, subject, sender, sender_address, date, uid, original_bucket)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    subject = COALESCE(excluded.subject, email_metadata.subject),
                    sender = COALESCE(excluded.sender, email_metadata.sender),
                    sender_address = COALESCE(excluded.sender_address, email_metadata.sender_address),
                    date = COALESCE(excluded.date, email_metadata.date),
                    uid = COALESCE(excluded.uid, email_metadata.uid),
                    original_bucket = excluded.original_bucket
            `, [
                decodedId,
                emailData?.subject || '(No Subject)',
                senderName,
                senderAddress,
                emailData?.date || new Date().toISOString(),
                emailData?.uid || null,
                bucketId
            ]);

            // Then, bucket entire thread
            await db.query(`
                UPDATE email_metadata 
                SET original_bucket = ? 
                WHERE normalized_subject = (SELECT normalized_subject FROM email_metadata WHERE message_id = ?)
            `, [bucketId, decodedId]);
        }

        // Handle "today" bucket - set due date
        const isTodayBucket = tags.some(tag => tag.toLowerCase() === 'today');
        if (isTodayBucket && bucketId) {
            const now = new Date();
            const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const noonET = new Date(etNow);
            noonET.setHours(12, 0, 0, 0);

            await db.query(`
                UPDATE email_metadata SET due_date = ? WHERE message_id = ?
            `, [noonET.toISOString(), decodedId]);
        }

        // Update bucket counts immediately from DB
        if (isUnbucketing && sourceBucketId) {
            const countResult = await db.query(
                'SELECT COUNT(*) as count FROM email_metadata WHERE original_bucket = ? AND date_archived IS NULL',
                [sourceBucketId]
            );
            await db.query('UPDATE buckets SET count = ? WHERE id = ?', [countResult.rows?.[0]?.count || 0, sourceBucketId]);
        }
        if (bucketId) {
            const countResult = await db.query(
                'SELECT COUNT(*) as count FROM email_metadata WHERE original_bucket = ? AND date_archived IS NULL',
                [bucketId]
            );
            await db.query('UPDATE buckets SET count = ? WHERE id = ?', [countResult.rows?.[0]?.count || 0, bucketId]);
        }

        invalidateBucketCache();

        // 2. RETURN SUCCESS IMMEDIATELY
        res.json({ success: true });

        // 3. IMAP OPERATIONS IN BACKGROUND (fire and forget)
        (async () => {
            try {
                await imapService.assignTags(decodedId, tags);
                console.log(`✓ IMAP tags assigned for ${decodedId}`);

                // If unbucketing, refresh inbox in background
                if (isUnbucketing) {
                    await imapService.fetchTriageEmails();
                }
            } catch (err) {
                console.error(`✗ Background IMAP tag assignment failed for ${decodedId}:`, err);
                // Note: DB already updated, IMAP will sync on next background run
            }
        })();

    } catch (err) {
        console.error('Error assigning tags:', err);
        res.status(500).json({ error: 'Failed to assign tags' });
    }
});

// POST /api/emails/:messageId/mark-read - Mark Email as Read
// FIRE-AND-FORGET: Returns immediately, IMAP operation runs in background
// This prevents 504 timeouts when IMAP lock is held by body fetches
router.post('/:messageId/mark-read', async (req, res) => {
    const { messageId } = req.params;
    const { uid } = req.query;
    const decodedId = decodeURIComponent(messageId);

    console.log(`Mark-as-read request - messageId: ${decodedId}, uid: ${uid}`);

    // Return success immediately (fire-and-forget)
    res.json({ success: true });

    // Do IMAP operation in background (non-blocking)
    (async () => {
        try {
            if (uid) {
                await imapService.markAsReadByUid(parseInt(uid as string), decodedId);
            } else {
                await imapService.markAsRead(decodedId);
            }
            console.log(`✓ Marked as read: ${decodedId.substring(0, 30)}`);
        } catch (err) {
            console.error(`✗ Background mark-as-read failed for ${decodedId}:`, err);
            // Note: We already returned success to the client
            // The next sync will eventually mark it as read
        }
    })();
});

// POST /api/emails/:messageId/archive - Archive an Email
router.post('/:messageId/archive', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { bucketId } = req.body;
        console.log(`[BACKEND] Archiving thread for ${decodedId}. Received bucketId: ${bucketId}`);

        const now = new Date().toISOString();

        // 1. Update UI state for ENTIRE thread (all emails with same normalized_subject)
        await db.query(`
            UPDATE email_metadata 
            SET date_archived = ?, original_bucket = ?
            WHERE normalized_subject = (SELECT normalized_subject FROM email_metadata WHERE message_id = ?)
        `, [now, bucketId || null, decodedId]);

        // 2. Archive in IMAP only if this email is NOT from Sent folder
        const meta = await db.query('SELECT mailbox FROM email_metadata WHERE message_id = ?', [decodedId]);
        const isFromSent = meta.rows?.[0]?.mailbox === 'Sent';

        if (!isFromSent) {
            await imapService.archiveEmail(decodedId);
        } else {
            console.log(`[BACKEND] Skipping IMAP archive for sent email ${decodedId}`);
        }

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

// POST /api/emails/:messageId/unarchive - Unarchive Email
router.post('/:messageId/unarchive', async (req, res) => {
    try {
        const { messageId } = req.params;
        const decodedId = decodeURIComponent(messageId);
        const { targetLocation } = req.body; // 'inbox' or bucket name

        // Check if this email is from the Sent folder
        const meta = await db.query('SELECT mailbox FROM email_metadata WHERE message_id = ?', [decodedId]);
        const isFromSent = meta.rows?.[0]?.mailbox === 'Sent';

        // Unarchive in IMAP only for received emails
        let unarchivedEmail = null;
        if (!isFromSent) {
            unarchivedEmail = await imapService.unarchiveEmail(decodedId, targetLocation);
        } else {
            console.log(`[BACKEND] Skipping IMAP unarchive for sent email ${decodedId}`);
            // For sent emails, we still need basic info for the response
            const emailMeta = await db.query('SELECT subject, sender, sender_address, date, uid FROM email_metadata WHERE message_id = ?', [decodedId]);
            unarchivedEmail = {
                messageId: decodedId,
                subject: emailMeta.rows?.[0]?.subject || '(No Subject)',
                from: [{ name: emailMeta.rows?.[0]?.sender, address: emailMeta.rows?.[0]?.sender_address }],
                date: emailMeta.rows?.[0]?.date,
                uid: emailMeta.rows?.[0]?.uid
            };
        }

        // Update DB for ENTIRE thread
        if (targetLocation === 'inbox') {
            // Clear archive and bucket for entire thread
            await db.query(`
                UPDATE email_metadata 
                SET date_archived = NULL, original_bucket = NULL
                WHERE normalized_subject = (SELECT normalized_subject FROM email_metadata WHERE message_id = ?)
            `, [decodedId]);

            // Force IMAP refresh so email appears in inbox immediately
            try {
                console.log('Refreshing inbox after unarchive...');
                await imapService.fetchTriageEmails();
            } catch (err) {
                console.error('Error refreshing inbox after unarchive:', err);
            }
        } else {
            // Restore to bucket for entire thread
            await db.query(`
                UPDATE email_metadata 
                SET date_archived = NULL, original_bucket = ?
                WHERE normalized_subject = (SELECT normalized_subject FROM email_metadata WHERE message_id = ?)
            `, [targetLocation, decodedId]);
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

// PUT /api/emails/metadata - Add/Update Notes, Due Date, and Preview
router.put('/metadata', async (req, res) => {
    try {
        const { messageId, notes, dueDate, preview } = req.body;

        if (!messageId) {
            return res.status(400).json({ error: 'messageId is required' });
        }

        const existing = await db.query('SELECT 1 FROM email_metadata WHERE message_id = ?', [messageId]);
        const exists = existing.rows && existing.rows.length > 0;

        if (exists) {
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

            values.push(messageId);
            const query = `UPDATE email_metadata SET ${fields.join(', ')} WHERE message_id = ?`;
            await db.query(query, values);
        } else {
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

export default router;
