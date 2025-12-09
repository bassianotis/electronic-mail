/**
 * Database Service
 * Handles SQLite database initialization and provides query helpers
 */
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { runMigrations } from '../db/migrationRunner';
import migrations from '../db/migrations';

let dbInstance: Database | null = null;

// Get database path from environment variable, fall back to local path for development
const getDbPath = (): string => {
    return process.env.DB_PATH || './database.sqlite';
};

export const initDb = async () => {
    try {
        const dbPath = getDbPath();
        console.log(`Initializing SQLite database at: ${dbPath}`);

        dbInstance = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        // Run versioned migrations (pass db instance to avoid circular dependency)
        await runMigrations(dbInstance, migrations);

        console.log('SQLite database initialized: migrations complete');
    } catch (err) {
        console.error('Error initializing SQLite database:', err);
        throw err;
    }
};

export const getDb = () => {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return dbInstance;
};

// Helper to mimic some of the PG query style if needed, 
// but we will mostly use getDb().all() or getDb().run()
export const db = {
    query: async (text: string, params: any[] = []) => {
        const db = getDb();
        // Simple heuristic: SELECT uses all(), others use run()
        if (text.trim().toUpperCase().startsWith('SELECT')) {
            const rows = await db.all(text, params);
            return { rows };
        } else {
            const result = await db.run(text, params);
            return { rowCount: result.changes };
        }
    }
};
