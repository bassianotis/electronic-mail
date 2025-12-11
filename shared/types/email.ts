/**
 * Core Email type used throughout the application.
 * This is the canonical representation of an email in the system.
 */
export interface Email {
    /** Message-ID header - primary identifier */
    id: string;
    /** IMAP UID - used for efficient fetching */
    uid?: string;
    /** Display name of sender */
    sender: string;
    /** Email address of sender */
    senderAddress?: string;
    /** Email subject line */
    subject: string;
    /** Short preview text (first 150 chars of body) */
    preview: string;
    /** Full HTML body content */
    body: string;
    /** Date email was received */
    date: Date;
    /** Whether email has been read */
    read: boolean;
    /** ID of bucket if assigned */
    bucketId?: string;
    /** User-added note */
    note?: string;
    /** Due date if set */
    dueDate?: Date;
    /** Original Message-ID (same as id, kept for compatibility) */
    messageId?: string;
    /** List of attachments */
    attachments?: Attachment[];
    /** Date when the email was archived, if applicable */
    dateArchived?: string;
    /** The ID of the bucket this email belonged to before archiving */
    originalBucket?: string;
    /** Thread ID for grouping related emails */
    threadId?: string;
    /** Message-ID of the email this replies to */
    inReplyTo?: string;
    /** Subject with Re:/Fwd: stripped for matching */
    normalizedSubject?: string;
    /** Which mailbox this email is in (INBOX, Sent, Drafts, Archives) */
    mailbox?: string;
}

/**
 * Email attachment metadata
 */
export interface Attachment {
    filename: string;
    contentType: string;
    size: number;
}

/**
 * Email as returned from API before date parsing
 */
export interface ApiEmailResponse {
    messageId: string;
    uid?: number | string;
    from?: Array<{ name?: string; address?: string }>;
    subject: string;
    date: string;
    preview?: string;
    snippet?: string;
    notes?: string;
    note?: string;
    dueDate?: string;
    due_date?: string;
    originalBucket?: string;
    original_bucket?: string;
    dateArchived?: string;
    date_archived?: string;
    bucketId?: string;
    attachments?: Array<{ filename: string; contentType: string; size: number }>;
}

/**
 * Extended email with archive-specific fields
 */
export interface ArchivedEmail extends Email {
    dateArchived?: string;
    originalBucket?: string;
}

/**
 * Thread group for displaying related emails as a single unit
 */
export interface ThreadGroup {
    /** Unique thread identifier */
    threadId: string;
    /** All emails in this thread */
    emails: Email[];
    /** Most recent email (used for display in collapsed view) */
    latestEmail: Email;
    /** Total number of emails in thread (received + sent) */
    count: number;
    /** Number of received emails only */
    receivedCount: number;
    /** Shared bucket ID (all received emails in thread share same bucket) */
    bucketId: string | null;
    /** True if thread resurfaced in inbox due to new email */
    hasNewEmail: boolean;
    /** Original bucket ID for "Return to [Bucket]" action */
    originalBucketId?: string;
}

/**
 * API response for ThreadGroup before client-side date parsing
 */
export interface ApiThreadGroupResponse {
    threadId: string;
    emails: ApiEmailResponse[];
    latestEmail: ApiEmailResponse;
    count: number;
    receivedCount: number;
    bucketId: string | null;
    hasNewEmail: boolean;
    originalBucketId?: string;
}
