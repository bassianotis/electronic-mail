import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { configService } from './configService';
import { db } from './dbService';
import nodemailer from 'nodemailer';

export interface DraftData {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    attachments: any[];
}

// Helper to normalize subject for thread matching (same logic as threadService)
const normalizeSubject = (subject: string): string => {
    if (!subject) return '';
    return subject
        .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

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

            let totalScanned = 0;
            let archivedSkipped = 0;
            let dateFilteredOut = 0;
            let savedToDb = 0;

            // Use the SAME broad search that getInboxMessageIds uses (confirmed working).
            // The 'or' array syntax with imapflow was failing silently.
            // Trade-off: Scans more messages but guarantees results.
            const searchCriteria = {
                deleted: false
            };

            console.log(`📧 [IMAP] Search Criteria (Broad): ${JSON.stringify(searchCriteria)}`);

            // Fetch from server - will scan all messages then filter locally
            for await (const message of client.fetch(
                searchCriteria,
                { envelope: true, uid: true, flags: true }
            ) as AsyncGenerator<ImapMessage>) {
                totalScanned++;

                // Safety check: Abort if client is disconnected
                if (!client || !client.usable) {
                    console.log('📧 [IMAP] Client disconnected during sync. Aborting.');
                    break;
                }

                // LOCAL FILTER: Skip bucketed emails
                if (message.flags && message.flags.has('$bucketed')) {
                    continue;
                }

                // LOCAL FILTER: Skip archived emails
                if (message.flags && message.flags.has('$archived')) {
                    archivedSkipped++;
                    continue;
                }

                if (message.envelope) {
                    const emailDate = message.envelope.date ? new Date(message.envelope.date) : null;
                    const isStarred = message.flags && message.flags.has('\\Flagged');

                    // STRICT VALIDATION: Skip emails with missing Message-ID or Sender
                    // This prevents "Zombie" emails (Unknown/Unknown) that cannot be archived or tracked.
                    if (!message.envelope.messageId || !message.envelope.from || message.envelope.from.length === 0) {
                        console.warn(`📧 [IMAP] Skipping malformed email (UID: ${message.uid}): Missing Message-ID or Sender.`);
                        continue;
                    }

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
                        const normalizedSubj = normalizeSubject(message.envelope.subject || '');

                        // DEFENSIVE: Only INSERT new records. On conflict, only update uid.
                        // NEVER overwrite subject/normalized_subject to prevent metadata corruption.
                        // Explicitly set mailbox='INBOX' to protect from Sent folder overwrite.
                        db.query(`
                            INSERT INTO email_metadata (message_id, subject, normalized_subject, sender, sender_address, date, snippet, uid, mailbox)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INBOX')
                            ON CONFLICT(message_id) DO UPDATE SET
                                uid = excluded.uid
                        `, [
                            message.envelope.messageId,
                            message.envelope.subject || '(No Subject)',
                            normalizedSubj,
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

            // Check Sent folder if configured
            const syncSettings = configService.getSyncSettings();
            const sentFolderName = syncSettings.sentFolderName;

            if (sentFolderName) {
                try {
                    const sentLock = await client.getMailboxLock(sentFolderName);
                    try {
                        await client.mailboxOpen(sentFolderName);
                        const searchResult = await client.search({ header: { 'message-id': messageId } });

                        if (searchResult && searchResult.length > 0) {
                            const seqNum = searchResult[0];
                            const message = await client.fetchOne(seqNum, { source: true });

                            if (message && typeof message !== 'boolean' && message.source) {
                                console.log(`✅ Found email via fallback search in Sent folder`);
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
                    } finally {
                        sentLock.release();
                    }
                } catch (err) {
                    console.error('Error searching Sent folder:', err);
                }
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

    // 4. Assign Tags by Message-ID (with UID fallback from database)
    assignTags: async (messageId: string, tags: string[]) => {
        await ensureConnection();

        // Get sent folder name from config
        const syncSettings = configService.getSyncSettings();
        const sentFolderName = syncSettings.sentFolderName;

        // First, try to get the UID from the database (more reliable than header search)
        let dbUid: number | null = null;
        let dbMailbox: string | null = null;
        try {
            const dbResult = await db.query(
                'SELECT uid, mailbox FROM email_metadata WHERE message_id = ?',
                [messageId]
            );
            if (dbResult.rows && dbResult.rows.length > 0) {
                dbUid = dbResult.rows[0].uid ? parseInt(dbResult.rows[0].uid, 10) : null;
                dbMailbox = dbResult.rows[0].mailbox || null;
                console.log(`[assignTags] DB lookup: UID=${dbUid}, mailbox=${dbMailbox}`);
            }
        } catch (err) {
            console.log(`[assignTags] DB lookup failed:`, err);
        }

        // Helper function to apply tags to a message by sequence number
        const applyTags = async (seqNum: number) => {
            if (tags.length === 0) {
                // Unbucket operation - remove all bucket-related tags
                console.log('Unbucketing email - removing all bucket-related tags');
                const message = await client.fetchOne(seqNum, { flags: true });
                if (message && typeof message !== 'boolean' && message.flags) {
                    const customKeywords = Array.from(message.flags).filter((flag: string) =>
                        flag.startsWith('$') && flag !== '\\Deleted' && flag !== '\\Seen' && flag !== '\\Flagged'
                    );
                    if (customKeywords.length > 0) {
                        console.log('Removing keywords:', customKeywords);
                        await client.messageFlagsRemove(seqNum, customKeywords);
                    }
                }
                console.log('Email unbucketed successfully');
            } else {
                // Normal bucketing: Add requested tags + $bucketed
                const allTags = [...tags, '$bucketed'];
                const sanitizedTags = allTags.map(tag => sanitizeKeyword(tag));
                console.log('Sanitized tags:', sanitizedTags);

                // First, remove all existing bucket tags
                const message = await client.fetchOne(seqNum, { flags: true });
                if (message && typeof message !== 'boolean' && message.flags) {
                    const customKeywords = Array.from(message.flags).filter((flag: string) =>
                        flag.startsWith('$') && flag !== '\\Deleted' && flag !== '\\Seen' && flag !== '\\Flagged'
                    );
                    if (customKeywords.length > 0) {
                        await client.messageFlagsRemove(seqNum, customKeywords);
                    }
                }

                // Add each keyword individually
                for (const tag of sanitizedTags) {
                    await client.messageFlagsAdd(seqNum, [tag]);
                }
                console.log('Tags added successfully');

                // Verify
                const verifyMessage = await client.fetchOne(seqNum, { flags: true });
                if (verifyMessage && typeof verifyMessage !== 'boolean') {
                    console.log('Current flags after tagging:', verifyMessage.flags);
                }
            }
        };

        console.log(`Assigning tags to email ${messageId}:`, tags);

        // Folders to search (INBOX first, then Sent if configured)
        const foldersToSearch = ['INBOX'];
        if (sentFolderName) {
            foldersToSearch.push(sentFolderName);
        }

        // Search for the email across folders using both Message-ID and UID approaches
        for (const folder of foldersToSearch) {
            const lock = await client.getMailboxLock(folder);
            try {
                // Approach 1: Try Message-ID header search first
                const searchResult = await client.search({ header: { 'message-id': messageId } });
                if (searchResult && searchResult.length > 0) {
                    const seqNum = searchResult[0];
                    console.log(`Found email ${messageId} in ${folder} at seq ${seqNum} (via Message-ID search)`);
                    await applyTags(seqNum);
                    return; // Success
                }

                // Approach 2: If we have a UID from DB, try UID-based fetch
                if (dbUid && (folder === 'INBOX' || (dbMailbox && folder.includes(dbMailbox)))) {
                    console.log(`[assignTags] Message-ID search failed, trying UID ${dbUid} in ${folder}`);
                    try {
                        // Fetch by UID to verify it exists and get the sequence number
                        const uidMessage = await client.fetchOne(`${dbUid}`, { envelope: true, uid: true }, { uid: true });
                        const hasEnvelope = uidMessage && typeof uidMessage !== 'boolean' && uidMessage.envelope;
                        console.log(`[assignTags] UID ${dbUid} fetch result:`, uidMessage ? 'found' : 'not found',
                            hasEnvelope ? `(msgId: ${(uidMessage as any).envelope.messageId?.substring(0, 30)}...)` : '(no envelope)');

                        if (uidMessage && typeof uidMessage !== 'boolean' && uidMessage.envelope) {
                            // Verify Message-ID matches (crucial!)
                            if (uidMessage.envelope.messageId === messageId) {
                                // We need the sequence number for flag operations, search by UID
                                const uidSearchResult = await client.search({ uid: `${dbUid}` });
                                if (uidSearchResult && uidSearchResult.length > 0) {
                                    const seqNum = uidSearchResult[0];
                                    console.log(`Found email ${messageId} in ${folder} at seq ${seqNum} (via UID ${dbUid})`);
                                    await applyTags(seqNum);
                                    return; // Success
                                }
                            } else {
                                console.log(`[assignTags] UID ${dbUid} has DIFFERENT Message-ID: ${uidMessage.envelope.messageId}`);
                                console.log(`[assignTags] Expected: ${messageId}`);
                                console.log(`[assignTags] This suggests stale UID in database - email may have been moved/deleted`);
                            }
                        } else {
                            console.log(`[assignTags] UID ${dbUid} does NOT exist in ${folder} - email may have been deleted from IMAP`);
                        }
                    } catch (uidErr) {
                        console.log(`[assignTags] UID-based fetch failed in ${folder}:`, uidErr);
                    }
                }
            } catch (err) {
                console.log(`Error searching in ${folder}:`, err);
            } finally {
                lock.release();
            }
        }

        // If we get here, email wasn't found in any folder
        throw new Error(`Email with Message-ID ${messageId} not found in INBOX or Sent`);
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

        // Check if email is ALREADY in Archives folder
        try {
            const archiveLock = await client.getMailboxLock('Archives');
            try {
                await client.mailboxOpen('Archives');
                const archiveSearch = await client.search({ header: { 'message-id': messageId } });
                if (archiveSearch && archiveSearch.length > 0) {
                    console.log(`[archiveEmail] Email ${messageId} already in Archives, skipping`);
                    return; // Already archived, nothing to do
                }
            } finally {
                archiveLock.release();
            }
        } catch (err) {
            console.log(`[archiveEmail] Could not check Archives folder: ${err}`);
        }

        // List of folders to search, in order of priority
        const foldersToSearch = ['INBOX', '$label1', '$label2', '$label3', '$label4', '$label5'];

        let foundInFolder: string | null = null;

        // Search each folder until we find the email
        for (const folder of foldersToSearch) {
            try {
                const lock = await client.getMailboxLock(folder);
                try {
                    await client.mailboxOpen(folder);
                    const searchResult = await client.search({ header: { 'message-id': messageId } });
                    if (searchResult && searchResult.length > 0) {
                        foundInFolder = folder;
                        const seqNum = searchResult[0];
                        console.log(`[archiveEmail] Found email ${messageId} in folder ${folder} at seq ${seqNum}`);

                        // Add $archived tag
                        console.log(`[archiveEmail] Adding $archived tag...`);
                        await client.messageFlagsAdd(seqNum, ['$archived']);
                        console.log(`[archiveEmail] Tag added successfully`);

                        // Move to Archives folder
                        console.log(`[archiveEmail] Moving email ${messageId} from ${folder} to Archives...`);
                        const moveResult = await client.messageMove(seqNum, 'Archives');
                        console.log(`[archiveEmail] Move result:`, moveResult);
                        console.log(`[archiveEmail] Email ${messageId} archived successfully from ${folder}`);
                        break;
                    }
                } finally {
                    lock.release();
                }
            } catch (err) {
                // Folder doesn't exist or other error, continue to next
                // Don't log for label folders as they may not exist
            }
        }

        if (!foundInFolder) {
            throw new Error(`Email with Message-ID ${messageId} not found in any folder`);
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

    // 6b. Fetch Sent Emails - From configured Sent folder (for thread display)
    fetchSentEmails: async (): Promise<EmailSummary[]> => {
        const syncSettings = configService.getSyncSettings();
        const sentFolderName = syncSettings.sentFolderName;

        // Skip if no sent folder configured
        if (!sentFolderName) {
            console.log('📤 [IMAP] No sent folder configured, skipping sent email sync');
            return [];
        }

        await ensureConnection();

        // Check if folder exists
        let folderExists = false;
        try {
            await client.mailboxOpen(sentFolderName, { readOnly: true });
            folderExists = true;
            await client.mailboxClose();
        } catch (err) {
            console.log(`📤 [IMAP] Sent folder "${sentFolderName}" does not exist or cannot be opened`);
            return [];
        }

        if (!folderExists) return [];

        const lock = await client.getMailboxLock(sentFolderName);
        try {
            await client.mailboxOpen(sentFolderName);
            const messages: EmailSummary[] = [];
            const cutoffDate = syncSettings.startDate ? new Date(syncSettings.startDate) : new Date('2025-11-30');

            console.log(`📤 [IMAP] Fetching sent emails from "${sentFolderName}" since ${cutoffDate.toISOString()}`);

            let totalScanned = 0;
            let savedToDb = 0;

            // Fetch all messages with envelope, flags, and headers (for threading)
            for await (const message of client.fetch('1:*', { envelope: true, uid: true }) as AsyncGenerator<ImapMessage>) {
                totalScanned++;

                if (message.envelope && message.envelope.date) {
                    const emailDate = new Date(message.envelope.date);

                    // Filter by start date
                    if (emailDate < cutoffDate) {
                        continue;
                    }

                    // Skip if missing Message-ID
                    if (!message.envelope.messageId) {
                        continue;
                    }

                    messages.push({
                        uid: message.uid,
                        messageId: message.envelope.messageId,
                        subject: message.envelope.subject,
                        from: message.envelope.from,
                        date: message.envelope.date
                    });

                    // Persist to DB with mailbox = 'Sent'
                    // For sent emails, we use 'to' as the main contact
                    const recipientName = message.envelope.to?.[0]?.name || message.envelope.to?.[0]?.address || 'Unknown';
                    const recipientAddress = message.envelope.to?.[0]?.address || '';
                    const senderName = syncSettings.displayName || message.envelope.from?.[0]?.name || 'Me';
                    const senderAddress = message.envelope.from?.[0]?.address || '';
                    const normalizedSubj = normalizeSubject(message.envelope.subject || '');

                    // DEFENSIVE: Only INSERT new records. On conflict, DO NOT overwrite mailbox.
                    // This prevents clobbering INBOX emails that also appear in Sent.
                    db.query(`
                        INSERT INTO email_metadata (message_id, subject, normalized_subject, sender, sender_address, date, snippet, uid, mailbox)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Sent')
                        ON CONFLICT(message_id) DO UPDATE SET
                            uid = excluded.uid
                    `, [
                        message.envelope.messageId,
                        message.envelope.subject || '(No Subject)',
                        normalizedSubj,
                        senderName,  // Use display name for sent emails
                        senderAddress,
                        message.envelope.date?.toISOString() || new Date().toISOString(),
                        `To: ${recipientName}`,  // Show recipient in snippet
                        message.uid
                    ]).then(() => { savedToDb++; }).catch(err => console.error('📤 [IMAP] Error persisting sent email to DB:', err));
                }
            }

            console.log(`📤 [IMAP] Sent email sync complete: ${totalScanned} scanned, ${messages.length} saved after date filter`);
            return messages;
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

            // 1. Search for email by Message-ID (returns UIDs)
            const searchUids = await client.search({ header: { 'message-id': messageId } }, { uid: true });
            if (!searchUids || searchUids.length === 0) {
                // Not in Archives - check if already in INBOX (may have been moved by another operation)
                lock.release();
                const inboxLock = await client.getMailboxLock('INBOX');
                try {
                    await client.mailboxOpen('INBOX');
                    const inboxSearch = await client.search({ header: { 'message-id': messageId } }, { uid: true });
                    if (inboxSearch && inboxSearch.length > 0) {
                        console.log(`[unarchiveEmail] Email ${messageId} already in INBOX with UID ${inboxSearch[0]}, skipping move`);
                        // Return a placeholder - the email is already where it needs to be
                        return {
                            uid: inboxSearch[0],
                            messageId,
                            subject: '(Already in INBOX)',
                            from: [],
                            date: new Date(),
                            snippet: '',
                            read: true,
                            starred: false
                        } as EmailSummary;
                    }
                } finally {
                    inboxLock.release();
                }
                throw new Error(`Email with Message-ID ${messageId} not found in Archives or INBOX`);
            }
            const uid = searchUids[0];
            console.log(`Found email ${messageId} in Archives with UID: ${uid}`);

            // 2. Fetch current flags AND envelope using UID (with retry for race conditions)
            let message: any = null;
            let fetchRetries = 3;
            while (fetchRetries > 0 && !message?.envelope) {
                message = await client.fetchOne(`${uid}`, { flags: true, envelope: true, uid: true }, { uid: true });
                if (!message || !message.envelope) {
                    fetchRetries--;
                    if (fetchRetries > 0) {
                        console.log(`[unarchiveEmail] fetchOne failed, retrying... (${fetchRetries} attempts left)`);
                        await new Promise(resolve => setTimeout(resolve, 200)); // Small delay before retry
                    }
                }
            }
            if (!message || !message.envelope) {
                throw new Error(`Could not fetch details for email ${messageId}`);
            }

            console.log(`Unarchiving email ${messageId} (UID: ${uid})`);
            console.log(`Current flags:`, message.flags);

            // Identify tags to remove
            const flagsToRemove = new Set(['$archived']);

            // If we are moving to inbox, or changing buckets, we should remove existing bucket tags
            if (message.flags) {
                message.flags.forEach((flag: string) => {
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
            // Re-open Archives to ensure we're in the correct mailbox (parallel operations may have switched it)
            await client.mailboxOpen('Archives');
            const currentPath = (client.mailbox as any)?.path || 'unknown';
            console.log(`Moving email UID ${uid} from Archives to INBOX... (current mailbox: ${currentPath})`);

            // Verify we're in Archives before moving
            if (currentPath !== 'INBOX.Archives') {
                console.error(`[unarchiveEmail] CRITICAL: Mailbox switched! Expected INBOX.Archives but got ${currentPath}`);
                await client.mailboxOpen('Archives'); // Try one more time
            }

            const moveResult = await client.messageMove(`${uid}`, 'INBOX', { uid: true });
            console.log(`Move result:`, moveResult);

            // Close Archives before verifying
            await client.mailboxClose();

            // 6. Verify the email actually moved to INBOX
            const verifyLock = await client.getMailboxLock('INBOX');
            try {
                await client.mailboxOpen('INBOX');
                const verifySearch = await client.search({ header: { 'message-id': messageId } }, { uid: true });
                if (!verifySearch || verifySearch.length === 0) {
                    console.error(`Email ${messageId} NOT found in INBOX after move! Move may have failed.`);
                    throw new Error(`Email move verification failed: ${messageId} not found in INBOX`);
                }
                console.log(`Email ${messageId} verified in INBOX with UID ${verifySearch[0]}`);
            } finally {
                verifyLock.release();
            }

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

    // Helper to resolve special folders (Drafts, Sent, etc.)
    resolveSpecialFolder: async (type: string, fallback: string): Promise<string> => {
        await ensureConnection();
        try {
            // Fetch list of folders with specialUse attributes
            const folders = await client.list();
            const special = folders.find(f => f.specialUse === type);
            if (special) {
                console.log(`Resolved special folder ${type} to ${special.path}`);
                return special.path;
            }
        } catch (err) {
            console.warn(`Failed to list folders for special use resolution: ${err}`);
        }
        return fallback;
    },

    // 10. Disconnect IMAP
    disconnect: async (): Promise<void> => {
        if (client) {
            console.log('Disconnecting IMAP client...');
            try {
                // Ensure logout happens cleanly
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
    },

    // 7. Save Draft to IMAP
    // Appends email to Drafts folder and optionally deletes previous version
    saveDraft: async (draft: DraftData, oldUid?: number): Promise<number | null> => {
        await ensureConnection();

        // 1. Resolve correct Drafts folder
        const draftsFolder = await imapService.resolveSpecialFolder('\\Drafts', 'Drafts');

        // Ensure folder exists (only if fallback was used or weird case)
        if (draftsFolder === 'Drafts') {
            try {
                await client.mailboxOpen(draftsFolder);
            } catch (err) {
                try {
                    await client.mailboxCreate('Drafts');
                } catch (createErr) { /* ignore */ }
            }
        }

        try {
            await client.mailboxOpen(draftsFolder);
        } catch (err) {
            console.error(`Failed to open drafts folder ${draftsFolder}:`, err);
            return null;
        }

        const lock = await client.getMailboxLock(draftsFolder);
        try {
            // 2. Build Raw Email using Nodemailer
            const transporter = nodemailer.createTransport({
                streamTransport: true,
                newline: 'windows' // Force CRLF for compatibility
            });

            // Convert base64 attachments to Nodemailer format
            const nodemailerAttachments = (draft.attachments || [])
                .filter((att: any) => att.content) // Only include attachments with content
                .map((att: any) => ({
                    filename: att.name,
                    content: Buffer.from(att.content, 'base64'),
                    contentType: att.type || 'application/octet-stream'
                }));

            const mailOptions = {
                from: configService.getImapConfig()?.user,
                to: draft.to,
                cc: draft.cc,
                bcc: draft.bcc,
                subject: draft.subject,
                html: draft.body,
                text: draft.body.replace(/<[^>]*>?/gm, ''),
                attachments: nodemailerAttachments
            };

            const info = await transporter.sendMail(mailOptions);

            // Convert stream to Buffer
            const rawMessage = await new Promise<Buffer>((resolve, reject) => {
                const stream = info.message as any;
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', (err: Error) => reject(err));
            });

            // Verify messages before
            // const messagesBefore = await client.fetch('1:*', { uid: true });
            // console.log(`[DEBUG] Messages in ${draftsFolder} before save:`, messagesBefore.map(m => m.uid));

            // 3. Append to Drafts
            const appendResult = await client.append(draftsFolder, rawMessage, ['\\Draft']);

            if (!appendResult) {
                throw new Error('Append returned false');
            }

            const newUid = appendResult.uid || null;

            // 4. Delete old version if exists
            if (oldUid) {
                try {
                    await client.messageDelete(`${oldUid}`, { uid: true });
                } catch (delErr: any) {
                    // If it fails (e.g., message doesn't exist), that's fine
                }
            }

            return newUid;
        } catch (err) {
            console.error('Error saving draft to IMAP:', err);
            return null;
        } finally {
            lock.release();
            // Force expunge by closing mailbox - some servers only expunge on close
            try {
                await client.mailboxClose();
            } catch (e) { /* ignore */ }
        }
    },

    // 8. Delete Draft from IMAP
    deleteDraft: async (uid: number) => {
        await ensureConnection();
        const draftsFolder = await imapService.resolveSpecialFolder('\\Drafts', 'Drafts');

        try {
            await ensureMailboxOpen(draftsFolder);

            const lock = await client.getMailboxLock(draftsFolder);
            try {
                // Use messageDelete with uid:true to flag as deleted AND expunge
                // We skip verification as it was causing 'Invalid messageset' errors on some servers
                if (uid && uid > 0) {
                    console.log(`[IMAP] Deleting draft ${uid} from ${draftsFolder}...`);
                    try {
                        await client.messageDelete(`${uid}`, { uid: true });
                        console.log(`[IMAP] Draft ${uid} marked for deletion.`);
                    } catch (delErr) {
                        console.warn(`[IMAP] messageDelete failed for ${uid}:`, delErr);
                    }
                } else {
                    console.warn(`[IMAP] Invalid UID ${uid}, skipping deletion.`);
                }

            } finally {
                lock.release();
                // Force expunge by closing mailbox
                try {
                    await client.mailboxClose();
                    console.log(`[IMAP] Mailbox closed to force expunge.`);
                } catch (e) { /* ignore */ }
            }
        } catch (err) {
            console.error(`Failed to delete draft ${uid} from IMAP:`, err);
        }
    },

    // 9. Copy sent email to Sent folder
    copyToSentFolder: async (email: {
        to: string[];
        cc?: string[];
        bcc?: string[];
        subject: string;
        html: string;
        text?: string;
        inReplyTo?: string;
        references?: string;
        attachments?: Array<{
            filename: string;
            content: Buffer | string;
            contentType?: string;
        }>;
    }, messageId?: string) => {
        await ensureConnection();

        const syncSettings = configService.getSyncSettings();
        const sentFolder = syncSettings.sentFolderName ||
            await imapService.resolveSpecialFolder('\\Sent', 'Sent');

        // Build raw email using nodemailer
        const imapConfig = configService.getImapConfig();
        if (!imapConfig) throw new Error('IMAP not configured');

        const transporter = nodemailer.createTransport({
            streamTransport: true,
            newline: 'unix'
        });

        const mailOptions = {
            from: imapConfig.user,
            to: email.to.join(', '),
            cc: email.cc?.join(', '),
            bcc: email.bcc?.join(', '),
            subject: email.subject,
            html: email.html,
            text: email.text,
            messageId: messageId,
            inReplyTo: email.inReplyTo,
            references: email.references,
            attachments: email.attachments?.map(att => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType
            }))
        };

        const info = await transporter.sendMail(mailOptions);

        // Convert stream to buffer
        let rawEmail: Buffer;
        if (info.message instanceof Buffer) {
            rawEmail = info.message;
        } else {
            const chunks: Buffer[] = [];
            for await (const chunk of info.message) {
                chunks.push(Buffer.from(chunk));
            }
            rawEmail = Buffer.concat(chunks);
        }

        // Append to Sent folder
        try {
            await ensureMailboxOpen(sentFolder);

            const lock = await client.getMailboxLock(sentFolder);
            try {
                // Append with \Seen flag (already read - we sent it)
                await client.append(sentFolder, rawEmail, ['\\Seen']);
                console.log(`[IMAP] Appended sent email to ${sentFolder}`);
            } finally {
                lock.release();
            }
        } catch (err) {
            console.error(`Failed to copy email to Sent folder:`, err);
            throw err;
        }
    }
};
