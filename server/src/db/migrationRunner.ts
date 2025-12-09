/**
 * Migration Runner
 * Handles versioned database migrations with tracking
 */

export interface Migration {
    version: number;
    name: string;
    up: (db: any) => Promise<void>;
}

/**
 * Run all pending migrations
 * @param db - The database instance (passed in to avoid circular dependency)
 * @param migrations - Array of migrations to run
 */
export async function runMigrations(db: any, migrations: Migration[]): Promise<void> {

    // Create migrations table if it doesn't exist
    await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    `);

    // Get applied migrations
    const applied = await db.all('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = new Set(applied.map((m: any) => m.version));

    // Sort migrations by version
    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    // Run pending migrations
    for (const migration of sorted) {
        if (appliedVersions.has(migration.version)) {
            continue; // Already applied
        }

        console.log(`Running migration ${migration.version}: ${migration.name}...`);

        try {
            await migration.up(db);

            // Record migration
            await db.run(
                'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
                [migration.version, migration.name, new Date().toISOString()]
            );

            console.log(`✓ Migration ${migration.version} complete`);
        } catch (err: any) {
            console.error(`✗ Migration ${migration.version} failed:`, err.message);
            throw err;
        }
    }
}

/**
 * Helper to add a column if it doesn't exist (SQLite doesn't have IF NOT EXISTS for ALTER TABLE)
 */
export async function addColumnIfNotExists(
    db: any,
    table: string,
    column: string,
    definition: string
): Promise<void> {
    try {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`  Added column ${column} to ${table}`);
    } catch (err: any) {
        if (!err.message.includes('duplicate column name')) {
            throw err;
        }
        // Column already exists, ignore
    }
}

export default { runMigrations, addColumnIfNotExists };
