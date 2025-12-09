/**
 * Email mapping utilities
 * Centralizes the conversion from API responses to Email objects
 */

import type { Email, ApiEmailResponse, ArchivedEmail, Attachment } from '../../shared/types';

/**
 * Parse a date string or return current date if invalid
 */
function parseDate(dateStr: string | undefined | null): Date {
    if (!dateStr) return new Date();
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Parse a local date string (YYYY-MM-DD) without timezone conversion
 * Returns undefined if the input is invalid
 */
export function parseLocalDate(dateStr: string | undefined | null): Date | undefined {
    if (!dateStr) return undefined;

    // Handle ISO format (YYYY-MM-DD or full ISO string)  
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length !== 3) return undefined;

    const [year, month, day] = parts.map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;

    // Create date at noon to avoid timezone issues
    return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Extract sender name and address from API response
 */
function extractSender(from: ApiEmailResponse['from']): { sender: string; senderAddress?: string } {
    if (!from || !from[0]) {
        return { sender: 'Unknown' };
    }

    return {
        sender: from[0].name || from[0].address || 'Unknown',
        senderAddress: from[0].address
    };
}

/**
 * Map a single API response to an Email object
 * This is the canonical mapping function used throughout the app
 */
export function mapApiResponseToEmail(msg: ApiEmailResponse, bucketId?: string): Email {
    const { sender, senderAddress } = extractSender(msg.from);

    return {
        id: msg.messageId,
        uid: msg.uid?.toString(),
        sender,
        senderAddress,
        subject: msg.subject || '(No Subject)',
        preview: msg.preview || msg.snippet || '',
        body: '<p>Loading body...</p>',
        date: parseDate(msg.date),
        read: false,
        messageId: msg.messageId,
        bucketId: bucketId || msg.bucketId,
        note: msg.note || msg.notes,
        dueDate: parseLocalDate(msg.dueDate || msg.due_date),
        attachments: msg.attachments?.map(a => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size
        })),
        originalBucket: msg.originalBucket || msg.original_bucket,
        dateArchived: msg.dateArchived || msg.date_archived,

    };
}

/**
 * Map an API response to an ArchivedEmail object
 */
export function mapApiResponseToArchivedEmail(msg: ApiEmailResponse): ArchivedEmail {
    const email = mapApiResponseToEmail(msg);

    return {
        ...email,
        dateArchived: msg.dateArchived || msg.date_archived,
        originalBucket: msg.originalBucket || msg.original_bucket
    };
}

/**
 * Map an array of API responses to Email objects
 * Optionally sort by date (newest first)
 */
export function mapApiResponsesToEmails(
    data: ApiEmailResponse[],
    options?: { bucketId?: string; sort?: boolean }
): Email[] {
    const emails = data.map(msg => mapApiResponseToEmail(msg, options?.bucketId));

    if (options?.sort !== false) {
        return emails.sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    return emails;
}

/**
 * Map an array of API responses to ArchivedEmail objects
 */
export function mapApiResponsesToArchivedEmails(data: ApiEmailResponse[]): ArchivedEmail[] {
    return data
        .map(mapApiResponseToArchivedEmail)
        .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Update an email with body content from API
 */
export function updateEmailWithBody(
    email: Email,
    body: { html: string; attachments?: Attachment[] },
    preview?: string
): Email {
    return {
        ...email,
        body: body.html,
        preview: preview || email.preview,
        attachments: body.attachments || email.attachments
    };
}
