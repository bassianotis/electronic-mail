/**
 * Sync Worker
 * Background service that keeps DB in sync with IMAP
 * Runs periodically to ensure data freshness without blocking UI
 * 
 * NOTE: Body pre-fetching removed - it caused socket timeouts.
 * Bodies are fetched on-demand by the frontend (useBackgroundPreviews)
 * and cached in DB for instant subsequent loads.
 */
import { imapService } from './imapService';
import { configService } from './configService';
import { db } from './dbService';
import { threadService } from './threadService';

let syncInterval: NodeJS.Timeout | null = null;
let isSyncing = false;  // Prevent concurrent syncs

// Sync every 5 minutes - less aggressive to avoid interrupting body fetches
const SYNC_INTERVAL = 5 * 60 * 1000;

/**
 * Check if sync is currently running
 * Used by email routes to avoid lock contention
 */
export function isSyncInProgress(): boolean {
    return isSyncing;
}

/**
 * Reconcile local DB with IMAP state
 * Detects emails that were archived/deleted from other email clients
 * Only checks emails after the configured sync start date
 * 
 * NOTE: This function has been DISABLED because it incorrectly marks emails
 * as "externally archived" when IMAP queries return incomplete results.
 * The mailbox column is now the source of truth for IMAP folder state.
 */
async function reconcileWithImap(): Promise<void> {
    console.log('  🔄 Reconciliation SKIPPED (disabled to prevent false positives)');

    // DISABLED: This logic was causing emails to be incorrectly marked as archived
    // when getInboxMessageIds() returned incomplete results due to pagination,
    // connection issues, or timing problems.
    // 
    // Instead, we now rely on:
    // 1. The mailbox column being set correctly during fetchTriageEmails()
    // 2. A consistency check that clears date_archived for emails where mailbox='INBOX'

    return;
}

/**
 * Cleanup orphaned database entries
 * Removes entries where the email no longer exists in IMAP
 * This handles cases where emails were deleted externally but still appear in the UI
 * 
 * IMPORTANT: Only targets emails WITHIN the sync date range. Emails from before
 * the sync start date are kept (they're not orphans, just outside the sync window).
 * 
 * Strategy: Check a sample of entries per sync cycle to avoid overwhelming IMAP.
 */
async function cleanupOrphanedEntries(): Promise<void> {
    try {
        // Get sync settings to determine date range
        const syncSettings = configService.getSyncSettings();
        const startDate = syncSettings.startDate ? new Date(syncSettings.startDate) : new Date('2025-06-01');

        // Find potential orphans: unbucketed/unarchived entries WITHIN the sync date range
        // that have no mailbox set (indicating they were never properly synced)
        const result = await db.query(`
            SELECT message_id, uid, date FROM email_metadata 
            WHERE uid IS NOT NULL 
              AND (mailbox IS NULL OR mailbox = '')
              AND (date_archived IS NULL OR date_archived = '')
              AND (original_bucket IS NULL OR original_bucket = '')
              AND date >= ?
            ORDER BY uid ASC
            LIMIT 10
        `, [startDate.toISOString()]);

        const candidates = result.rows || [];
        if (candidates.length === 0) {
            return; // No orphan candidates to check
        }

        console.log(`  🧹 Checking ${candidates.length} potential orphaned entries (within sync range)...`);

        // Get actual IMAP message IDs from inbox
        const imapMessageIds = await imapService.getInboxMessageIds();

        let orphansDeleted = 0;
        for (const candidate of candidates) {
            // If the message_id isn't in the IMAP inbox, it's an orphan
            const existsInImap = imapMessageIds.includes(candidate.message_id);
            if (!existsInImap) {
                console.log(`    🗑️  Removing orphaned entry: ${candidate.message_id.substring(0, 40)}...`);
                await db.query('DELETE FROM email_metadata WHERE message_id = ?', [candidate.message_id]);
                orphansDeleted++;
            }
        }

        if (orphansDeleted > 0) {
            console.log(`  🧹 Deleted ${orphansDeleted} orphaned database entries`);
        }
    } catch (err) {
        console.error('  ⚠️ Orphan cleanup failed:', err);
        // Don't throw - this is a non-critical operation
    }
}

/**
 * Sync all bucket emails from IMAP to DB
 * Called at startup and periodically
 */
export async function syncAllBuckets(): Promise<void> {
    if (!configService.isConfigured()) {
        console.log('⏭️  Skipping bucket sync - IMAP not configured');
        return;
    }

    // Prevent concurrent syncs
    if (isSyncing) {
        console.log('⏭️  Skipping bucket sync - already in progress');
        return;
    }

    isSyncing = true;

    try {
        console.log('🔄 Starting bucket sync...');

        // Get all buckets
        const bucketsResult = await db.query('SELECT id FROM buckets');
        const buckets = bucketsResult.rows || [];

        // 1. Sync inbox emails (Prioritized for UX)
        console.log('  🔄 Syncing inbox emails (Priority)...');
        try {
            await imapService.fetchTriageEmails();
            console.log('  ✓ Inbox sync complete');
        } catch (err) {
            console.error('  ✗ Inbox sync failed:', err);
        }

        // 2. Reconcile inbox with IMAP (detect external changes)
        await reconcileWithImap();

        // 2b. Cleanup orphaned database entries (phantom emails)
        await cleanupOrphanedEntries();

        // 3. Sync sent emails (for thread display)
        console.log('  📤 Syncing sent emails...');
        try {
            await imapService.fetchSentEmails();
            console.log('  ✓ Sent email sync complete');
        } catch (err) {
            console.error('  ✗ Sent email sync failed:', err);
        }

        // 4. Sync all buckets
        for (const bucket of buckets) {
            try {
                console.log(`  Syncing bucket: ${bucket.id}`);
                const emails = await imapService.fetchBucketEmails(bucket.id);

                // Upsert each email to DB
                for (const email of emails) {
                    const senderName = email.from?.[0]?.name || email.from?.[0]?.address || 'Unknown';
                    const senderAddress = email.from?.[0]?.address || '';

                    // DEFENSIVE: Only INSERT new records. On conflict, only update uid/bucket.
                    // NEVER overwrite subject/sender to prevent metadata corruption.
                    await db.query(`
                        INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, uid, original_bucket)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(message_id) DO UPDATE SET
                            uid = excluded.uid,
                            original_bucket = excluded.original_bucket
                    `, [
                        email.messageId,
                        email.subject || '(No Subject)',
                        senderName,
                        senderAddress,
                        email.date instanceof Date ? email.date.toISOString() : new Date().toISOString(),
                        email.uid,
                        bucket.id
                    ]);
                }

                // Update bucket count
                await db.query('UPDATE buckets SET count = ? WHERE id = ?', [emails.length, bucket.id]);
                console.log(`  ✓ Synced ${emails.length} emails for ${bucket.id}`);
            } catch (err) {
                console.error(`  ✗ Failed to sync bucket ${bucket.id}:`, err);
            }
        }

        // 5. Backfill thread IDs for any new emails
        // This ensures thread counts are accurate immediately after sync
        await threadService.backfillThreadIds();

        console.log('🔄 Bucket sync complete');
    } catch (err) {
        console.error('❌ Bucket sync failed:', err);
    } finally {
        isSyncing = false;
    }
}

/**
 * Start the background sync worker
 */
export function startSyncWorker(): void {
    if (syncInterval) {
        console.log('Sync worker already running');
        return;
    }

    console.log(`🔄 Starting sync worker (interval: ${SYNC_INTERVAL / 1000}s)`);

    // Run initial sync immediately (short delay for connection stability)
    setTimeout(() => {
        syncAllBuckets();
    }, 1000);  // 1 second - quick start

    // Schedule periodic syncs
    syncInterval = setInterval(() => {
        syncAllBuckets();
    }, SYNC_INTERVAL);
}

/**
 * Stop the background sync worker
 */
export function stopSyncWorker(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('Sync worker stopped');
    }
}
