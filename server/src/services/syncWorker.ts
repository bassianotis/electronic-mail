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
 */
async function reconcileWithImap(): Promise<void> {
    console.log('  🔄 Running reconciliation...');

    try {
        // Get sync start date from config
        const syncSettings = configService.getSyncSettings();
        const cutoffDate = syncSettings.startDate ? new Date(syncSettings.startDate) : new Date('2025-11-30');

        // Get all message IDs currently in IMAP inbox (already filtered by date)
        const imapMessageIds = await imapService.getInboxMessageIds();
        const imapIdSet = new Set(imapMessageIds);

        // Get all message IDs in local DB that should be in inbox (after cutoff date)
        const dbResult = await db.query(`
            SELECT message_id FROM email_metadata 
            WHERE original_bucket IS NULL 
            AND date_archived IS NULL
            AND date >= ?
        `, [cutoffDate.toISOString()]);

        const dbMessageIds = (dbResult.rows || []).map((r: any) => r.message_id);

        // Mark as externally archived any emails in DB but not in IMAP
        let removed = 0;
        for (const dbId of dbMessageIds) {
            if (!imapIdSet.has(dbId)) {
                await db.query(`
                    UPDATE email_metadata 
                    SET date_archived = ?, original_bucket = 'external'
                    WHERE message_id = ?
                `, [new Date().toISOString(), dbId]);
                removed++;
                console.log(`    ↪ Externally archived: ${dbId.substring(0, 30)}`);
            }
        }

        if (removed > 0) {
            console.log(`  ✓ Reconciliation: ${removed} emails marked as externally archived`);
        } else {
            console.log(`  ✓ Reconciliation: all ${dbMessageIds.length} emails still in IMAP`);
        }
    } catch (err) {
        console.error('  ✗ Reconciliation failed:', err);
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

        for (const bucket of buckets) {
            try {
                console.log(`  Syncing bucket: ${bucket.id}`);
                const emails = await imapService.fetchBucketEmails(bucket.id);

                // Upsert each email to DB
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

        // Sync inbox emails (fetch new emails from IMAP)
        console.log('  🔄 Syncing inbox emails...');
        try {
            await imapService.fetchTriageEmails();
            console.log('  ✓ Inbox sync complete');
        } catch (err) {
            console.error('  ✗ Inbox sync failed:', err);
        }

        // Reconcile inbox with IMAP (detect external changes)
        await reconcileWithImap();

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

    // Run initial sync after a longer delay (give UI time to load first)
    setTimeout(() => {
        syncAllBuckets();
    }, 10000);  // 10 seconds instead of 5

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
