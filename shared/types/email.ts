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
