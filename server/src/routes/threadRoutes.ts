/**
 * Thread Routes
 * REST API endpoints for thread operations
 */
import express from 'express';
import { threadService } from '../services/threadService';

const router = express.Router();

/**
 * GET /api/threads/inbox
 * Get all inbox threads (unbucketed, unarchived)
 */
router.get('/inbox', async (req, res) => {
    try {
        const threads = await threadService.getInboxThreads();
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (err) {
        console.error('[threadRoutes] Error fetching inbox threads:', err);
        res.status(500).json({ error: 'Failed to fetch inbox threads' });
    }
});

/**
 * GET /api/threads/bucket/:bucketId
 * Get threads for a specific bucket
 */
router.get('/bucket/:bucketId', async (req, res) => {
    try {
        const { bucketId } = req.params;
        const threads = await threadService.getBucketThreads(bucketId);
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (err) {
        console.error('[threadRoutes] Error fetching bucket threads:', err);
        res.status(500).json({ error: 'Failed to fetch bucket threads' });
    }
});

/**
 * GET /api/threads/archive
 * Get all archived threads
 */
router.get('/archive', async (req, res) => {
    try {
        const threads = await threadService.getArchiveThreads();
        res.json({
            threads,
            totalThreads: threads.length,
            totalEmails: threads.reduce((sum, t) => sum + t.count, 0)
        });
    } catch (err) {
        console.error('[threadRoutes] Error fetching archive threads:', err);
        res.status(500).json({ error: 'Failed to fetch archive threads' });
    }
});

/**
 * POST /api/threads/:threadId/bucket
 * Move entire thread to a bucket
 */
router.post('/:threadId/bucket', async (req, res) => {
    try {
        const { threadId } = req.params;
        const { bucketId } = req.body;

        if (!bucketId) {
            return res.status(400).json({ error: 'bucketId is required' });
        }

        await threadService.moveThreadToBucket(decodeURIComponent(threadId), bucketId);
        res.json({ success: true });
    } catch (err) {
        console.error('[threadRoutes] Error moving thread to bucket:', err);
        res.status(500).json({ error: 'Failed to move thread to bucket' });
    }
});

/**
 * POST /api/threads/:threadId/archive
 * Archive entire thread
 */
router.post('/:threadId/archive', async (req, res) => {
    try {
        const { threadId } = req.params;
        await threadService.archiveThread(decodeURIComponent(threadId));
        res.json({ success: true });
    } catch (err) {
        console.error('[threadRoutes] Error archiving thread:', err);
        res.status(500).json({ error: 'Failed to archive thread' });
    }
});

/**
 * POST /api/threads/:threadId/unarchive
 * Unarchive entire thread
 */
router.post('/:threadId/unarchive', async (req, res) => {
    try {
        const { threadId } = req.params;
        const { targetLocation } = req.body;

        if (!targetLocation) {
            return res.status(400).json({ error: 'targetLocation is required (inbox or bucketId)' });
        }

        await threadService.unarchiveThread(decodeURIComponent(threadId), targetLocation);
        res.json({ success: true });
    } catch (err) {
        console.error('[threadRoutes] Error unarchiving thread:', err);
        res.status(500).json({ error: 'Failed to unarchive thread' });
    }
});

/**
 * POST /api/threads/:threadId/unbucket
 * Move thread back to inbox
 */
router.post('/:threadId/unbucket', async (req, res) => {
    try {
        const { threadId } = req.params;
        await threadService.unbucketThread(decodeURIComponent(threadId));
        res.json({ success: true });
    } catch (err) {
        console.error('[threadRoutes] Error unbucketing thread:', err);
        res.status(500).json({ error: 'Failed to unbucket thread' });
    }
});

/**
 * POST /api/threads/backfill
 * Compute thread_ids for existing emails
 */
router.post('/backfill', async (req, res) => {
    try {
        const updated = await threadService.backfillThreadIds();
        res.json({ success: true, updated });
    } catch (err) {
        console.error('[threadRoutes] Error backfilling thread IDs:', err);
        res.status(500).json({ error: 'Failed to backfill thread IDs' });
    }
});

/**
 * GET /api/threads/:threadId/emails
 * Get all emails in a specific thread with full body content
 */
router.get('/:threadId/emails', async (req, res) => {
    try {
        const { threadId } = req.params;
        const emails = await threadService.getThreadEmails(decodeURIComponent(threadId));
        res.json({
            emails,
            count: emails.length
        });
    } catch (err) {
        console.error('[threadRoutes] Error fetching thread emails:', err);
        res.status(500).json({ error: 'Failed to fetch thread emails' });
    }
});

export default router;

