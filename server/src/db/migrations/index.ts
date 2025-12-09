/**
 * All Database Migrations
 * 
 * Each migration should have:
 * - version: Unique integer (use timestamps or sequential numbers)
 * - name: Human-readable description
 * - up: Function that applies the migration
 */
import type { Migration } from '../migrationRunner';
import { addColumnIfNotExists } from '../migrationRunner';

const migrations: Migration[] = [
    {
        version: 1,
        name: 'initial_schema',
        up: async (db) => {
            // Base tables (these use IF NOT EXISTS so they're safe to re-run)
            await db.exec(`
                CREATE TABLE IF NOT EXISTS email_metadata (
                    message_id TEXT PRIMARY KEY,
                    notes TEXT,
                    due_date TEXT
                );

                CREATE TABLE IF NOT EXISTS buckets (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    color TEXT NOT NULL,
                    count INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS email_rules (
                    id TEXT PRIMARY KEY,
                    sender_pattern TEXT NOT NULL,
                    bucket_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            `);
        }
    },
    {
        version: 2,
        name: 'archive_columns',
        up: async (db) => {
            await addColumnIfNotExists(db, 'email_metadata', 'date_archived', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'original_bucket', 'TEXT');
        }
    },
    {
        version: 3,
        name: 'rules_processed_column',
        up: async (db) => {
            await addColumnIfNotExists(db, 'email_metadata', 'rules_processed', 'INTEGER DEFAULT 0');
        }
    },
    {
        version: 4,
        name: 'bucket_sort_order',
        up: async (db) => {
            await addColumnIfNotExists(db, 'buckets', 'sort_order', 'INTEGER DEFAULT 0');
        }
    },
    {
        version: 5,
        name: 'email_preview_column',
        up: async (db) => {
            await addColumnIfNotExists(db, 'email_metadata', 'preview', 'TEXT');
        }
    },
    {
        version: 6,
        name: 'inbox_cache_columns',
        up: async (db) => {
            await addColumnIfNotExists(db, 'email_metadata', 'subject', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'sender', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'sender_address', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'date', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'snippet', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'uid', 'INTEGER');
        }
    },
    {
        version: 7,
        name: 'email_body_cache',
        up: async (db) => {
            // Cache email bodies to avoid repeated IMAP fetches
            await addColumnIfNotExists(db, 'email_metadata', 'body_html', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'body_text', 'TEXT');
            await addColumnIfNotExists(db, 'email_metadata', 'body_fetched_at', 'TEXT');
        }
    },
    {
        version: 8,
        name: 'clear_cached_errors',
        up: async (db) => {
            // Clear cached error messages so they get re-fetched
            await db.run(`
                UPDATE email_metadata 
                SET body_html = NULL, body_text = NULL, body_fetched_at = NULL
                WHERE body_html IS NOT NULL AND length(body_html) < 100
            `);
            console.log('✓ Cleared cached error messages from body_html');
        }
    },
    {
        version: 9,
        name: 'cleanup_ghost_emails',
        up: async (db) => {
            // Remove "ghost" emails - entries with missing/malformed data that cause UI issues
            // These are typically emails that were synced before validation was added
            const result = await db.run(`
                DELETE FROM email_metadata 
                WHERE 
                    sender IS NULL 
                    OR sender = '' 
                    OR sender = 'Unknown'
                    OR sender_address IS NULL
                    OR sender_address = ''
                    OR subject = 'No Subject'
                    OR message_id IS NULL
                    OR message_id = ''
            `);
            console.log(`✓ Cleaned up ${result.changes || 0} ghost/malformed email entries`);
        }
    }
];

export default migrations;
