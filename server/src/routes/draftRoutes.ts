/**
 * Draft Routes
 * Handles saving, updating, and deleting email drafts
 */
import { Router } from 'express';
import { db } from '../services/dbService';
import { imapService } from '../services/imapService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/drafts - List all drafts
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM drafts ORDER BY updated_at DESC');

        // Parse JSON fields
        const drafts = (result.rows || []).map(draft => ({
            ...draft,
            to: tryParse(draft.to),
            cc: tryParse(draft.cc),
            bcc: tryParse(draft.bcc),
            attachments: tryParse(draft.attachments)
        }));

        res.json(drafts);
    } catch (err) {
        console.error('Error listing drafts:', err);
        res.status(500).json({ error: 'Failed to list drafts' });
    }
});

// GET /api/drafts/reply/:messageId - Get draft for a specific reply
router.get('/reply/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const result = await db.query(
            'SELECT * FROM drafts WHERE in_reply_to = ? LIMIT 1',
            [messageId]
        );

        if (result.rows && result.rows.length > 0) {
            const draft = result.rows[0];
            res.json({
                ...draft,
                to: tryParse(draft.to),
                cc: tryParse(draft.cc),
                bcc: tryParse(draft.bcc),
                attachments: tryParse(draft.attachments)
            });
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error('Error fetching draft by reply:', err);
        res.status(500).json({ error: 'Failed to fetch draft' });
    }
});

// POST /api/drafts - Save/Update draft
router.post('/', async (req, res) => {
    try {
        const { id, to, cc, bcc, subject, body, attachments, inReplyTo } = req.body;

        const draftId = id || uuidv4();
        const now = new Date().toISOString();

        // Convert arrays to JSON strings
        const toStr = JSON.stringify(to || []);
        const ccStr = JSON.stringify(cc || []);
        const bccStr = JSON.stringify(bcc || []);
        const attStr = JSON.stringify(attachments || []);

        // Check for existing draft to get previous IMAP UID
        const existingResult = await db.query('SELECT imap_uid FROM drafts WHERE id = ?', [draftId]);
        const currentImapUid = existingResult.rows?.[0]?.imap_uid;

        // Upsert with in_reply_to
        await db.query(`
            INSERT INTO drafts (id, "to", cc, bcc, subject, body, attachments, in_reply_to, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                "to" = excluded."to",
                cc = excluded.cc,
                bcc = excluded.bcc,
                subject = excluded.subject,
                body = excluded.body,
                attachments = excluded.attachments,
                in_reply_to = excluded.in_reply_to,
                updated_at = excluded.updated_at
        `, [
            draftId,
            toStr,
            ccStr,
            bccStr,
            subject || '',
            body || '',
            attStr,
            inReplyTo || null,
            now,
            now
        ]);

        // 4. Synchronous IMAP Sync (to prevent duplicates)
        try {
            const newImapUid = await imapService.saveDraft({
                to: to || [],
                cc: cc || [],
                bcc: bcc || [],
                subject: subject || '',
                body: body || '',
                attachments: attachments || []
            }, currentImapUid);

            if (newImapUid) {
                await db.query('UPDATE drafts SET imap_uid = ? WHERE id = ?', [newImapUid, draftId]);
            }
        } catch (syncErr) {
            console.error('IMAP draft sync failed:', syncErr);
            // We continue even if sync fails, as local save succeeded
        }

        res.json({ success: true, id: draftId });
    } catch (err) {
        console.error('Error saving draft:', err);
        res.status(500).json({ error: 'Failed to save draft' });
    }
});

// DELETE /api/drafts/:id - Delete draft
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get IMAP UID before creating
        const result = await db.query('SELECT imap_uid FROM drafts WHERE id = ?', [id]);
        const imapUid = result.rows?.[0]?.imap_uid;

        await db.query('DELETE FROM drafts WHERE id = ?', [id]);

        // Synchronous IMAP Delete
        if (imapUid) {
            try {
                await imapService.deleteDraft(imapUid);
            } catch (syncErr) {
                console.error('IMAP draft delete failed:', syncErr);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting draft:', err);
        res.status(500).json({ error: 'Failed to delete draft' });
    }
});

// Helper to safely parse JSON
function tryParse(str: string | null) {
    if (!str) return [];
    try {
        return JSON.parse(str);
    } catch {
        return [];
    }
}

export default router;
