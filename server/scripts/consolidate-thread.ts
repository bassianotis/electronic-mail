/**
 * One-off script to consolidate a thread into a single location
 * Run with: npx tsx server/scripts/consolidate-thread.ts
 */
import { imapService } from '../src/services/imapService';
import { db, initDb } from '../src/services/dbService';

const SUBJECT_PATTERN = 'christ church disability course';
const TARGET_BUCKET = '$label1'; // Move all to this bucket

async function consolidateThread() {
    // Initialize database first
    await initDb();

    console.log(`\n🔄 Consolidating thread: "${SUBJECT_PATTERN}"`);
    console.log(`📂 Target: ${TARGET_BUCKET}\n`);

    // Find all emails with matching subject
    const result = await db.query(`
        SELECT message_id, subject, original_bucket, date_archived 
        FROM email_metadata 
        WHERE LOWER(subject) LIKE ?
    `, [`%${SUBJECT_PATTERN.toLowerCase()}%`]);

    if (!result.rows || result.rows.length === 0) {
        console.log('❌ No emails found matching pattern');
        return;
    }

    console.log(`📧 Found ${result.rows.length} emails to consolidate:\n`);

    for (const row of result.rows) {
        console.log(`  - ${row.message_id.substring(0, 40)}...`);
        console.log(`    Subject: ${row.subject?.substring(0, 50)}`);
        console.log(`    Bucket: ${row.original_bucket || 'inbox'}`);
        console.log(`    Archived: ${row.date_archived ? 'Yes' : 'No'}\n`);
    }

    // Step 1: Unarchive any archived emails
    const archivedEmails = result.rows.filter((r: any) => r.date_archived);
    if (archivedEmails.length > 0) {
        console.log(`\n📤 Unarchiving ${archivedEmails.length} emails...`);
        for (const row of archivedEmails) {
            try {
                await imapService.unarchiveEmail(row.message_id, TARGET_BUCKET);
                console.log(`  ✅ Unarchived: ${row.message_id.substring(0, 30)}...`);
            } catch (err: any) {
                console.log(`  ⚠️ Skip (may already be unarchived): ${row.message_id.substring(0, 30)}...`);
            }
        }
    }

    // Step 2: Update database - set all to same bucket, clear archive date
    console.log(`\n💾 Updating database...`);
    const messageIds = result.rows.map((r: any) => r.message_id);
    const placeholders = messageIds.map(() => '?').join(',');

    await db.query(`
        UPDATE email_metadata 
        SET original_bucket = ?, date_archived = NULL
        WHERE message_id IN (${placeholders})
    `, [TARGET_BUCKET, ...messageIds]);

    console.log(`\n✅ Done! All ${result.rows.length} emails consolidated to ${TARGET_BUCKET}`);
    console.log('🔄 Refresh your bucket view to see the thread.\n');

    process.exit(0);
}

consolidateThread().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
