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
    /** Number of emails in this thread (for display) */
    threadCount?: number;
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
    threadId?: string;
    threadCount?: number;
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
    /** Total number of emails in thread */
    count: number;
    /** Most recent email (used for display in collapsed view) */
    latestEmail: {
        messageId: string;
        uid?: number;
        subject: string;
        sender: string;
        senderAddress?: string;
        date: string;
        preview: string;
        body?: string;
    };
    /** True if thread has new unread email */
    hasNewEmail?: boolean;
    /** Original bucket ID for "Return to [Bucket]" action */
    originalBucketId?: string;
}

/**
 * API response for ThreadGroup
 */
export interface ApiThreadGroupResponse {
    threadId: string;
    count: number;
    latestEmail: {
        messageId: string;
        uid?: number;
        subject: string;
        sender: string;
        senderAddress?: string;
        date: string;
        preview: string;
        body?: string;
    };
    hasNewEmail?: boolean;
    originalBucketId?: string;
}

