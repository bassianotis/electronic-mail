import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { configService } from './configService';
import { db } from './dbService';

const createClient = () => {
    const imapConfig = configService.getImapConfig();

    if (!imapConfig) {
        throw new Error('IMAP configuration not found. Please complete setup.');
    }

    const newClient = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port,
        secure: imapConfig.secure,
        auth: {
            user: imapConfig.user,
            pass: imapConfig.password
        },
        logger: false,
        // Stability settings to prevent connection drops
        socketTimeout: 5 * 60 * 1000,     // 5 minutes - allow long operations
        greetingTimeout: 30 * 1000,        // 30 seconds for initial greeting
        connectionTimeout: 30 * 1000,      // 30 seconds to establish connection
        disableAutoIdle: true,             // We manage our own connection lifecycle
    });

    // Prevent crash on error
    newClient.on('error', (err) => {
        console.error('IMAP Client Error:', err);
    });

    newClient.on('close', () => {
        console.log('IMAP Client Closed');
    });

    return newClient;
};

let client: ImapFlow;

export const connectImap = async () => {
    try {
        client = createClient();
        await client.connect();
        console.log('IMAP connected');
    } catch (error) {
        console.error('Failed to connect to IMAP:', error);
        throw error;
    }
};

export const reconnectImap = async () => {
    console.log('Reconnecting IMAP with new credentials...');

    // Close existing connection if it exists
    if (client && client.usable) {
        try {
            await client.logout();
        } catch (e) {
            console.error('Error during logout:', e);
        }
    }

    // Create new connection with updated credentials
    await connectImap();
    console.log('IMAP reconnected successfully');
};

const ensureConnection = async () => {
    if (!client || !client.usable) {
        console.log('IMAP connection lost, reconnecting...');
        await connectImap();
        console.log('IMAP reconnected successfully');
    }
};

// Helper to safely open a mailbox - avoids redundant SELECT commands that corrupt session
const ensureMailboxOpen = async (mailboxName: string) => {
    // Check if mailbox is already selected
    if (client.mailbox && client.mailbox.path === mailboxName) {
        // Already open, no need to re-select
        return;
    }
    await client.mailboxOpen(mailboxName);
};

// Helper function to sanitize keywords for IMAP
// IMAP keywords can only contain alphanumeric characters, hyphens, and underscores
const sanitizeKeyword = (keyword: string): string => {
    if (keyword.startsWith('$')) {
        // Preserve the $ prefix and sanitize the rest
        return '$' + keyword.slice(1).replace(/[^a-zA-Z0-9_-]/g, '_');
    } else {
        // Add $ prefix and sanitize
        return '$' + keyword.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
};

interface ImapAddress {
    name?: string;
    address?: string;
}

interface ImapEnvelope {
    date: Date;
    subject: string;
    messageId: string;
    from: ImapAddress[];
    to: ImapAddress[];
}

interface ImapMessage {
    uid: number;
    seq: number;
    envelope: ImapEnvelope;
    flags: Set<string>;
    source?: Buffer;
}

interface EmailAttachment {
    filename: string;
    contentType: string;
    size: number;
    content: any; // Buffer or stream
}

interface FetchedEmail {
    html: string | boolean;
    text: string | undefined;
    attachments: EmailAttachment[];
}

interface EmailSummary {
    uid: number;
    messageId: string;
    subject: string;
    from: ImapAddress[];
    date: Date;
    flags?: Set<string>;
}

interface MailParserAttachment {
    filename?: string;
    contentType: string;
    size: number;
    content: any;
}

interface FetchOptions {
    envelope?: boolean;
    uid?: boolean;
    flags?: boolean;
    source?: boolean;
}

export const imapService = {
    // 1. Fetch Triage Emails (Inbox, not bucketed)
    // Only fetches emails from configured start date onwards, optionally including starred
    fetchTriageEmails: async () => {
        await ensureConnection();
        console.log('📧 [IMAP] Acquiring lock on INBOX...');
        const lock = await client.getMailboxLock('INBOX');
        console.log('📧 [IMAP] Lock acquired. Fetching messages...');
        try {
            const messages: EmailSummary[] = [];
            const syncSettings = configService.getSyncSettings();
            const cutoffDate = syncSettings.startDate ? new Date(syncSettings.startDate) : new Date('2025-11-30');
            const includeStarred = syncSettings.importStarred !== false; // Default to true if not set

            console.log(`📧 [IMAP] Cutoff date: ${cutoffDate.toISOString()}, importStarred: ${includeStarred}`);
            console.log(`📧 [IMAP] Searching for: NOT $bucketed, NOT deleted`);

            let totalScanned = 0;
            let archivedSkipped = 0;
            let dateFilteredOut = 0;
            let savedToDb = 0;

            // Fetch all non-bucketed, non-deleted emails
            for await (const message of client.fetch(
                { not: { keyword: '$bucketed' }, deleted: false },
                { envelope: true, uid: true, flags: true }
            ) as AsyncGenerator<ImapMessage>) {
                totalScanned++;

                // Safety check: Abort if client is disconnected (e.g. during logout)
                if (!client || !client.usable) {
                    console.log('📧 [IMAP] Client disconnected during sync. Aborting.');
                    break;
                }

                // Skip archived emails
                if (message.flags && message.flags.has('$archived')) {
                    archivedSkipped++;
                    continue;
                }

                if (message.envelope) {
                    const emailDate = message.envelope.date ? new Date(message.envelope.date) : null;
                    const isStarred = message.flags && message.flags.has('\\Flagged');

                    // Include if: (date >= cutoffDate) OR (starred AND importStarred enabled)
                    if ((emailDate && emailDate >= cutoffDate) || (isStarred && includeStarred)) {
                        const emailData = {
                            uid: message.uid,
                            messageId: message.envelope.messageId,
                            subject: message.envelope.subject,
                            from: message.envelope.from,
                            date: message.envelope.date
                        };
                        messages.push(emailData);

                        // Persist to DB for offline access
                        const senderName = message.envelope.from?.[0]?.name || message.envelope.from?.[0]?.address || 'Unknown';
                        const senderAddress = message.envelope.from?.[0]?.address || '';

                        // Fire and forget DB update
                        db.query(`
                            INSERT INTO email_metadata (message_id, subject, sender, sender_address, date, snippet, uid)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(message_id) DO UPDATE SET
                                subject = excluded.subject,
                                sender = excluded.sender,
                                sender_address = excluded.sender_address,
                                date = excluded.date,
                                uid = excluded.uid
                        `, [
                            message.envelope.messageId,
                            message.envelope.subject || '(No Subject)',
                            senderName,
                            senderAddress,
                            message.envelope.date?.toISOString() || new Date().toISOString(),
                            '', // Snippet not available in envelope fetch, requires body fetch
                            message.uid
                        ]).then(() => { savedToDb++; }).catch(err => console.error('📧 [IMAP] Error persisting email to DB:', err));
                    } else {
                        dateFilteredOut++;
                    }
                }
            }

            const cutoffDateStr = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            console.log(`📧 [IMAP] Scan complete: ${totalScanned} total, ${archivedSkipped} archived skipped, ${dateFilteredOut} before cutoff, ${messages.length} returned`);
            console.log(`📧 [IMAP] Cutoff: ${cutoffDateStr}`);
            return messages;
        } catch (err) {
            console.error('Error in fetchTriageEmails:', err);
            throw err;
        } finally {
            console.log('Releasing lock...');
            lock.release();
        }
    },

    // 2. Fetch Single Email Body
    fetchEmail: async (messageId: string, uid?: string) => {
        await ensureConnection();
        let lock = await client.getMailboxLock('INBOX');

        try {
            // Use ensureMailboxOpen to avoid redundant SELECT commands
            try {
                const openWithTimeout = Promise.race([
                    ensureMailboxOpen('INBOX'),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('mailboxOpen timeout (5s)')), 5000)
                    )
                ]);
                await openWithTimeout;
            } catch (openErr: any) {
                // If mailboxOpen times out, force reconnect and retry ONCE
                console.log(`📨 [BODY] mailboxOpen failed, forcing reconnect: ${openErr.message}`);
                lock.release();

                // Force close and reconnect
                try { await client.logout(); } catch (e) { /* ignore */ }
                await connectImap();

                // Re-acquire lock and open mailbox
                const newLock = await client.getMailboxLock('INBOX');
                try {
                    await ensureMailboxOpen('INBOX');
                    lock = newLock;
                } catch (retryErr) {
                    newLock.release();
                    throw retryErr;
                }
            }

            // OPTIMIZATION: If UID is provided, try to fetch directly by UID
            if (uid) {
                try {
                    const uidNum = parseInt(uid, 10);

                    // Add timeout to prevent indefinite hanging
                    const fetchWithTimeout = async () => {
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('UID fetch timeout (10s)')), 10000)
                        );

                        // Use fetchOne instead of fetch loop - better cleanup
                        const fetchPromise = client.fetchOne(
                            `${uidNum}`,
                            { source: true, envelope: true, uid: true },
                            { uid: true }
                        );

                        return Promise.race([fetchPromise, timeoutPromise]);
                    };

                    const foundMessage: any = await fetchWithTimeout();

                    // Verify Message-ID matches (crucial!)
                    if (foundMessage && foundMessage.envelope && foundMessage.envelope.messageId === messageId && foundMessage.source) {
                        const parsed = await simpleParser(foundMessage.source as any);

                        // Extract attachments
                        const attachments = parsed.attachments ? parsed.attachments.map((att: MailParserAttachment) => ({
                            filename: att.filename || 'unnamed',
                            contentType: att.contentType,
                            size: att.size,
                            content: att.content // We send content for download. For large files, might want to stream.
                        })) : [];

                        return {
                            html: parsed.html || parsed.textAsHtml || parsed.text,
                            text: parsed.text,
                            attachments
                        };
                    } else if (foundMessage) {
                        const envMsgId = foundMessage.envelope ? foundMessage.envelope.messageId : 'unknown';
                        console.warn(`⚠️ UID ${uid} found but Message-ID mismatch. Expected ${messageId}, got ${envMsgId}. Falling back to search.`);
                    } else {
                        console.warn(`⚠️ No message found for UID ${uid}. Falling back to search.`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ Fast fetch failed for UID ${uid}:`, err?.message || err);
                }
            }

            // Fallback: Search by Message-ID (slower but reliable)
            console.log(`Searching for email with Message-ID: ${messageId}`);

            // Search in Archives first (common case for archived emails)
            try {
                // We need to release INBOX lock to check Archives? 
                // Actually, we can just check Archives if not found in INBOX, or check both.
                // But we are already in INBOX. Let's check INBOX first if we are here.

                const searchResult = await client.search({ header: { 'message-id': messageId } });

                if (searchResult && searchResult.length > 0) {
                    const seqNum = searchResult[0];
                    const message = await client.fetchOne(seqNum, { source: true });

                    if (message && typeof message !== 'boolean' && message.source) {
                        console.log(`✅ Found email via fallback search in INBOX`);
                        const parsed = await simpleParser(message.source as any);

                        const attachments = parsed.attachments ? parsed.attachments.map((att: MailParserAttachment) => ({
                            filename: att.filename || 'unnamed',
                            contentType: att.contentType,
                            size: att.size,
                            content: att.content
                        })) : [];

                        return {
                            html: parsed.html || parsed.textAsHtml || parsed.text,
                            text: parsed.text,
                            attachments
                        };
                    }
                }
            } catch (err) {
                console.log('Not found in INBOX or search failed, checking Archives...');
            } finally {
                // ALWAYS release the INBOX lock before moving to Archives or returning
                lock.release();
            }

            // If not found in INBOX, check Archives
            // We need to release lock and switch folder
            // lock.release(); // This was moved into the finally block above

            // Check Archives
            const archiveLock = await client.getMailboxLock('Archives');
            try {
                await client.mailboxOpen('Archives');
                const searchResult = await client.search({ header: { 'message-id': messageId } });

                if (searchResult && searchResult.length > 0) {
                    const seqNum = searchResult[0];
                    const message = await client.fetchOne(seqNum, { source: true });

                    if (message && typeof message !== 'boolean' && message.source) {
                        console.log(`✅ Found email via fallback search in Archives`);
                        const parsed = await simpleParser(message.source as any);

                        const attachments = parsed.attachments ? parsed.attachments.map((att: MailParserAttachment) => ({
                            filename: att.filename || 'unnamed',
                            contentType: att.contentType,
                            size: att.size,
                            content: att.content
                        })) : [];

                        return {
                            html: parsed.html || parsed.textAsHtml || parsed.text,
                            text: parsed.text,
                            attachments
                        };
                    }
                }
            } catch (err) {
                console.error('Error searching Archives:', err);
            } finally {
                archiveLock.release();
            }

            return { html: '<p>Email not found.</p>', text: 'Email not found.' };
        } catch (err) {
            console.error('Error in fetchEmail:', err);
            return { html: '<p>Error fetching email.</p>', text: 'Error fetching email.' };
        } finally {
            // Ensure INBOX lock is released (idempotent check)
            try { lock.release(); } catch (e) { }
        }
    },

    // 2b. Get all message IDs from inbox (fast, for reconciliation)
    // Used to detect emails archived/deleted from other email clients
    // Only returns emails after the configured sync start date, optionally including starred
    getInboxMessageIds: async (): Promise<string[]> => {
        await ensureConnection();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const messageIds: string[] = [];

            // Get sync settings from config
            const syncSettings = configService.getSyncSettings();
            const cutoffDate = syncSettings.startDate ? new Date(syncSettings.startDate) : new Date('2025-11-30');
            const includeStarred = syncSettings.importStarred !== false; // Default to true if not set

            // Fetch only envelope (no body) - fast!
            // Filter: not bucketed, not deleted, after cutoff date
            for await (const message of client.fetch(
                { not: { keyword: '$bucketed' }, deleted: false },
                { envelope: true, uid: true, flags: true }
            ) as AsyncGenerator<ImapMessage>) {
                // Skip archived emails
                if (message.flags && message.flags.has('$archived')) {
                    continue;
                }

                // Apply date filter
                if (message.envelope?.date) {
                    const emailDate = new Date(message.envelope.date);
                    const isStarred = message.flags && message.flags.has('\\Flagged');

                    // Include if: (date >= cutoff) OR (starred AND importStarred enabled)
                    if (emailDate >= cutoffDate || (isStarred && includeStarred)) {
                        if (message.envelope?.messageId) {
                            messageIds.push(message.envelope.messageId);
                        }
                    }
                }
            }

            console.log(`📬 [RECONCILE] Found ${messageIds.length} emails in IMAP inbox (after ${cutoffDate.toISOString().split('T')[0]}, starred=${includeStarred})`);
            return messageIds;
        } finally {
            lock.release();
        }
    },

    // 3. Fetch Bucket Emails
    fetchBucketEmails: async (bucketName: string): Promise<EmailSummary[]> => {
        await ensureConnection();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const messages: EmailSummary[] = [];

            // Sanitize the bucket name to match how it was tagged
            const keywordToSearch = sanitizeKeyword(bucketName);
            console.log(`Searching for emails with keyword: ${keywordToSearch} (original: ${bucketName})`);

            // Search for messages with the specific keyword
            for await (const message of client.fetch(
                { keyword: keywordToSearch, deleted: false },
                { envelope: true, uid: true, flags: true, source: false }
            ) as AsyncGenerator<ImapMessage>) {
                // Skip archived emails
                if (message.flags && message.flags.has('$archived')) {
                    continue;
                }

                if (message.envelope) {
                    messages.push({
                        uid: message.uid,
                        messageId: message.envelope.messageId,
                        subject: message.envelope.subject,
                        from: message.envelope.from,
                        date: message.envelope.date,
                        flags: message.flags
                    });
                }
            }
            return messages;
        } finally {
            lock.release();
        }
    },

    // 3b. Count Emails in Bucket (for indicators)
    countEmailsInBucket: async (bucketName: string): Promise<number> => {
        await ensureConnection();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const keywordToSearch = sanitizeKeyword(bucketName);
            let count = 0;

            for await (const message of client.fetch(
                { keyword: keywordToSearch, deleted: false },
                { uid: true, flags: true }
            )) {
                // Skip archived emails
                if (message.flags && message.flags.has('$archived')) {
                    continue;
                }
                count++;
            }

            return count;
        } finally {
            lock.release();
        }
    },

    // 4. Assign Tags by Message-ID
    assignTags: async (messageId: string, tags: string[]) => {
        await ensureConnection();
        const lock = await client.getMailboxLock('INBOX');
        try {
            console.log(`Assigning tags to email ${messageId}:`, tags);

            // Search for email by Message-ID
            const searchResult = await client.search({ header: { 'message-id': messageId } });
            if (!searchResult || searchResult.length === 0) {
                throw new Error(`Email with Message-ID ${messageId} not found`);
            }
            const seqNum = searchResult[0];
            console.log(`Found sequence number ${seqNum} for Message-ID ${messageId}`);

            // If tags array is empty, this is an unbucket operation
            if (tags.length === 0) {
                console.log('Unbucketing email - removing all bucket-related tags');

                // Fetch current flags using sequence number
                const message = await client.fetchOne(seqNum, { flags: true });
                if (message && typeof message !== 'boolean' && message.flags) {
                    // Remove all custom keywords (those starting with $)
                    const customKeywords = Array.from(message.flags).filter((flag: string) =>
                        flag.startsWith('$') && flag !== '\\Deleted' && flag !== '\\Seen' && flag !== '\\Flagged'
                    );

                    if (customKeywords.length > 0) {
                        console.log('Removing keywords:', customKeywords);
                        await client.messageFlagsRemove(seqNum, customKeywords);
                    }
                }

                console.log('Email unbucketed successfully');
                return;
            }

            // Normal bucketing: Add requested tags + $bucketed
            const allTags = [...tags, '$bucketed'];

            // Sanitize tags using the shared function
            const sanitizedTags = allTags.map(tag => sanitizeKeyword(tag));

            console.log('Sanitized tags:', sanitizedTags);

            // First, remove all existing bucket tags, then add the new ones
            const message = await client.fetchOne(seqNum, { flags: true });
            if (message && typeof message !== 'boolean' && message.flags) {
                const customKeywords = Array.from(message.flags).filter((flag: string) =>
                    flag.startsWith('$') && flag !== '\\Deleted' && flag !== '\\Seen' && flag !== '\\Flagged'
                );

                if (customKeywords.length > 0) {
                    await client.messageFlagsRemove(seqNum, customKeywords);
                }
            }

            // Add each keyword individually (they already have $ prefix from sanitization)
            for (const tag of sanitizedTags) {
                await client.messageFlagsAdd(seqNum, [tag]);
            }

            console.log('Tags added successfully');

            // Verify by fetching the message flags
            const verifyMessage = await client.fetchOne(seqNum, { flags: true });
            if (verifyMessage && typeof verifyMessage !== 'boolean') {
                console.log('Current flags after tagging:', verifyMessage.flags);
            }
        } catch (err) {
            console.error('Error assigning tags:', err);
            throw err;
        } finally {
            lock.release();
        }
    },

    // 5. Archive Email by Message-ID - Tag AND move to Archives folder
    archiveEmail: async (messageId: string) => {
        await ensureConnection();

        // First, ensure Archives folder exists
        try {
            await client.mailboxOpen('Archives', { readOnly: true });
            await client.mailboxClose();
        } catch (err) {
            // Folder doesn't exist, create it
            console.log('Creating Archives folder...');
            await client.mailboxCreate('Archives');
        }

        const lock = await client.getMailboxLock('INBOX');
        try {
            await client.mailboxOpen('INBOX');

            // Search for email by Message-ID
            const searchResult = await client.search({ header: { 'message-id': messageId } });
            if (!searchResult || searchResult.length === 0) {
                throw new Error(`Email with Message-ID ${messageId} not found`);
            }
            const seqNum = searchResult[0];

            // Add $archived tag first
            await client.messageFlagsAdd(seqNum, ['$archived']);

            // Move to Archives folder (this will remove from INBOX)
            console.log(`Moving email ${messageId} to Archives folder...`);
            await client.messageMove(seqNum, 'Archives');
            console.log(`Email ${messageId} archived successfully`);
        } finally {
            lock.release();
        }
    },

    // 6. Fetch Archived Emails - From Archives folder
    fetchArchivedEmails: async () => {
        await ensureConnection();

        // Check if Archives folder exists
        try {
            await client.mailboxOpen('Archives', { readOnly: true });
        } catch (err) {
            // Archives folder doesn't exist, return empty array
            console.log('Archives folder does not exist');
            return [];
        }

        const lock = await client.getMailboxLock('Archives');
        try {
            const messages: EmailSummary[] = [];

            // Fetch all emails from Archives folder
            // We fetch headers first to filter by date locally (IMAP SEARCH SINCE is better but this is safer for now)
            const fetchOptions: FetchOptions = { envelope: true, uid: true, source: false };

            for await (const message of client.fetch('1:*', fetchOptions) as AsyncGenerator<ImapMessage>) {
                if (message.envelope && message.envelope.date) {
                    const emailDate = new Date(message.envelope.date);
                    const startDateStr = configService.getSyncSettings().startDate;

                    // Filter by start date if set
                    if (startDateStr && emailDate < new Date(startDateStr)) {
                        continue;
                    }

                    messages.push({
                        uid: message.uid,
                        messageId: message.envelope.messageId,
                        subject: message.envelope.subject,
                        from: message.envelope.from,
                        date: message.envelope.date
                    });
                }
            }

            // Sort by date descending (newest first)
            return messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        } finally {
            lock.release();
        }
    },

    // 7. Unarchive Email by Message-ID - Move from Archives folder back to INBOX
    unarchiveEmail: async (messageId: string, targetLocation: string): Promise<EmailSummary> => {
        await ensureConnection();

        // Lock Archives folder since we're moving FROM it
        const lock = await client.getMailboxLock('Archives');

        try {
            await client.mailboxOpen('Archives');

            // 1. Search for email by Message-ID
            const searchIds = await client.search({ header: { 'message-id': messageId } });
            if (!searchIds || searchIds.length === 0) {
                throw new Error(`Email with Message-ID ${messageId} not found in Archives`);
            }
            const sequenceNum = searchIds[0];

            // 2. Fetch current flags AND envelope (to return full details)
            // We MUST get the UID to perform safe operations
            const message = await client.fetchOne(sequenceNum, { flags: true, envelope: true, uid: true });
            if (!message || !message.envelope || !message.uid) {
                throw new Error(`Could not fetch details for email ${messageId}`);
            }

            const uid = message.uid;
            console.log(`Unarchiving email ${messageId} (UID: ${uid})`);
            console.log(`Current flags:`, message.flags);

            // Identify tags to remove
            const flagsToRemove = new Set(['$archived']);

            // If we are moving to inbox, or changing buckets, we should remove existing bucket tags
            if (message.flags) {
                message.flags.forEach(flag => {
                    // Remove $bucketed
                    if (flag === '$bucketed') {
                        flagsToRemove.add(flag);
                    }
                    // Remove any tag starting with $ that isn't a system flag (bucket tags)
                    if (flag.startsWith('$') && flag !== '$archived') {
                        flagsToRemove.add(flag);
                    }
                });
            }

            // 3. Remove old tags using UID
            if (flagsToRemove.size > 0) {
                const tagsList = Array.from(flagsToRemove);
                console.log(`Removing tags from UID ${uid}:`, tagsList);
                await client.messageFlagsRemove(`${uid}`, tagsList, { uid: true });
            }

            // 4. If targeting a specific bucket, add new tags NOW (before move) using UID
            if (targetLocation !== 'inbox') {
                const sanitizedBucketTag = sanitizeKeyword(targetLocation);
                console.log(`Adding new bucket tags to UID ${uid}:`, [sanitizedBucketTag, '$bucketed']);
                await client.messageFlagsAdd(`${uid}`, [sanitizedBucketTag, '$bucketed'], { uid: true });
            }

            // 5. Move back to INBOX using UID
            console.log(`Moving email UID ${uid} from Archives to INBOX...`);
            await client.messageMove(`${uid}`, 'INBOX', { uid: true });

            await client.mailboxClose();
            console.log(`Email ${messageId} unarchived successfully to ${targetLocation}`);

            // Return the full email summary
            return {
                uid: message.uid,
                messageId: message.envelope.messageId || `unknown-${message.uid}`,
                subject: message.envelope.subject || '(No Subject)',
                from: message.envelope.from || [],
                date: message.envelope.date || new Date(),
                flags: message.flags
            };
        } finally {
            lock.release();
        }
    },

    // 8. Mark Email as Read by Message-ID
    markAsRead: async (messageId: string): Promise<void> => {
        await ensureConnection();

        // Helper function to try marking as read in a specific folder
        const tryMarkReadInFolder = async (folderName: string): Promise<boolean> => {
            const lock = await client.getMailboxLock(folderName);
            try {
                await client.mailboxOpen(folderName);

                // Search for email by Message-ID
                const searchResult = await client.search({ header: { 'message-id': messageId } });

                if (!searchResult || searchResult.length === 0) {
                    return false;
                }

                const seqNum = searchResult[0];

                // Add \Seen flag to mark as read
                await client.messageFlagsAdd(seqNum, ['\\Seen']);

                console.log(`Marked email ${messageId} as read in ${folderName}`);
                return true;
            } catch (err) {
                console.error(`Error marking as read in ${folderName}:`, err);
                return false;
            } finally {
                lock.release();
            }
        };

        // Try INBOX first
        if (await tryMarkReadInFolder('INBOX')) return;

        // Try Archives
        if (await tryMarkReadInFolder('Archives')) return;


        console.warn(`Email with Message-ID ${messageId} not found to mark as read`);
    },

    // 8b. Mark Email as Read by UID (more efficient when UID is known)
    markAsReadByUid: async (uid: number, messageId: string): Promise<void> => {
        await ensureConnection();

        const lock = await client.getMailboxLock('INBOX');
        try {
            await ensureMailboxOpen('INBOX');

            // Directly mark as read using UID (no search needed)
            await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });

            console.log(`Marked email ${messageId} (UID: ${uid}) as read in INBOX`);
        } catch (err) {
            console.error(`Error marking as read by UID ${uid}:`, err);
            // Fallback to Message-ID search if UID fails
            console.log('Falling back to Message-ID search');
            await imapService.markAsRead(messageId);
        } finally {
            lock.release();
        }
    },

    // 9. Auto-Discover Buckets from IMAP Flags
    discoverAndCreateBuckets: async (): Promise<{ discovered: number; created: number }> => {
        await ensureConnection();
        console.log('🔍 Starting bucket auto-discovery...');

        const lock = await client.getMailboxLock('INBOX');
        try {
            // Scan all emails to find custom keywords (bucket flags)
            const bucketFlags = new Set<string>();

            for await (const message of client.fetch('1:*', { flags: true })) {
                if (message.flags) {
                    for (const flag of message.flags) {
                        // Look for custom flags starting with $ (but not system flags)
                        if (typeof flag === 'string' &&
                            flag.startsWith('$') &&
                            !['$bucketed', '$archived'].includes(flag.toLowerCase())) {
                            bucketFlags.add(flag);
                        }
                    }
                }
            }

            console.log(`📊 Found ${bucketFlags.size} potential bucket flags:`, Array.from(bucketFlags));

            // Create buckets in database
            let created = 0;
            const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1'];

            for (const flag of bucketFlags) {
                // Remove $ prefix and convert to readable label
                const bucketId = flag.toLowerCase();
                const label = flag.substring(1)
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');

                try {
                    // Check if bucket already exists
                    const existing = await db.query(
                        'SELECT id FROM buckets WHERE id = ?',
                        [bucketId]
                    );

                    if (!existing.rows || existing.rows.length === 0) {
                        // Create new bucket
                        const color = colors[created % colors.length];
                        await db.query(
                            'INSERT INTO buckets (id, label, color, count, sort_order) VALUES (?, ?, ?, 0, ?)',
                            [bucketId, label, color, created]
                        );
                        console.log(`✅ Created bucket: ${label} (${bucketId})`);
                        created++;
                    } else {
                        console.log(`⏭️  Bucket already exists: ${label} (${bucketId})`);
                    }
                } catch (error) {
                    console.error(`❌ Failed to create bucket ${bucketId}:`, error);
                }
            }

            console.log(`🎉 Bucket discovery complete. ${created} new buckets created.`);
            return { discovered: bucketFlags.size, created };

        } finally {
            lock.release();
        }
    },

    // 10. Disconnect IMAP
    disconnectImap: async (): Promise<void> => {
        if (client) {
            console.log('Disconnecting IMAP client...');
            try {
                if (client.usable) {
                    await client.logout();
                } else {
                    // If not usable, just close
                    await client.close();
                }
            } catch (err) {
                console.error('Error disconnecting IMAP:', err);
                // Force close if logout fails
                try {
                    await client.close();
                } catch (e) {
                    // Ignore
                }
            } finally {
                // @ts-ignore
                client = null; // Clear the client reference
                console.log('IMAP client disconnected');
            }
        }
    }
};
