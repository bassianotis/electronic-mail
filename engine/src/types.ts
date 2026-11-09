export interface AccountConfig {
    /** Stable account id (the app's email_accounts.id). */
    id: string;
    email: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
}

/**
 * What a folder is for. Roles come from the server's SPECIAL-USE flags, or the folder name on
 * servers that don't advertise them, plus our own `Buckets/` convention. See docs/architecture.md, rules 5 and 7.
 */
export type FolderRole = 'inbox' | 'bucket' | 'archive' | 'sent' | 'drafts' | 'junk' | 'trash' | 'other';

/** Roles whose messages count as "received mail sitting somewhere" for thread location. */
export const LOCATION_ROLES: ReadonlySet<FolderRole> = new Set(['inbox', 'bucket', 'archive', 'other']);

/** Roles that never contribute to threads shown in views. */
export const HIDDEN_ROLES: ReadonlySet<FolderRole> = new Set(['junk', 'trash', 'drafts']);
