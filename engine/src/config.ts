// Reads account connection details from the current app's database (read-only), so the new
// engine runs against the same accounts without a separate setup step during the rebuild.
import { DatabaseSync } from 'node:sqlite';
import type { AccountConfig } from './types.ts';

export function loadAccountsFromAppDb(path: string): AccountConfig[] {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 10000'); // the old app may be writing; wait our turn
    try {
        return (db.prepare(`SELECT id, email_address, imap_host, imap_port, imap_secure, imap_user, imap_password
            FROM email_accounts ORDER BY email_address`).all() as {
                id: string; email_address: string; imap_host: string; imap_port: number; imap_secure: number;
                imap_user: string; imap_password: string;
            }[]).map(a => ({
                id: a.id,
                email: a.email_address,
                host: a.imap_host,
                port: a.imap_port,
                secure: !!a.imap_secure,
                user: a.imap_user,
                pass: a.imap_password,
            }));
    } finally {
        db.close();
    }
}
