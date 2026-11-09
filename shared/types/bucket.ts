/**
 * A bucket is a real folder on the mail server (docs/architecture.md, rule 7); the app keeps only how it looks.
 */
export interface Bucket {
    /** The bucket's folder on the server (e.g. INBOX.Buckets.Reads); also its id on screen. */
    id: string;
    /** The bucket's name. */
    label: string;
    /** Conversations in it. */
    count: number;
    unreadThreads?: number;
    sortOrder?: number;
    /** Hex color for bucket display */
    color: string;
    /** Optional emoji icon (replaces first-letter in dock) */
    emoji?: string;
    /** Whether to show the item count badge */
    showBadge?: boolean;
    /** Its conversations also appear in Up next, above the Inbox */
    showOnHome?: boolean;
    /** "Archive items older than N days" (null: off) */
    autoArchiveDays?: number | null;
}
