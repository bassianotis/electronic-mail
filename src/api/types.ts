/**
 * Shapes returned by the engine's /api/v2 (engine/src/api/server.ts and the modules it calls).
 * Kept by hand; engine/README.md lists the routes.
 */

export interface ThreadCard {
    threadId: string;
    /** Folder the conversation lives in (Inbox, a bucket, Archive); null when it holds only mail you sent. */
    location: string | null;
    latestDate: string | null;
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    messageCount: number;
    unread: number;
    latestMsgKey: string;
    /** First ~200 characters of the latest message; null until the engine has fetched it. */
    preview: string | null;
    hasSent: boolean;
}

export interface ViewPage {
    state: string;
    count: number;
    unreadThreads: number;
    threads: ThreadCard[];
}

export interface ThreadMessage {
    msgKey: string;
    messageId: string | null;
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    date: string | null;
    preview: string | null;
    seen: boolean;
    sent: boolean;
    folders: { path: string; role: string }[];
    /** The message it answers, when that's in this conversation (In-Reply-To, else References). */
    parentKey: string | null;
}

export interface ThreadDetail {
    state: string;
    thread: ThreadCard;
    /** Oldest first. */
    messages: ThreadMessage[];
}

export interface Address {
    name: string | null;
    address: string;
}

export interface AttachmentInfo {
    part: string;
    filename: string | null;
    contentType: string;
    size: number | null;
}

export interface MessageBody {
    msgKey: string;
    headers: {
        from: Address[];
        to: Address[];
        cc: Address[];
        replyTo: Address[];
        subject: string | null;
        date: string | null;
    };
    html: string | null;
    text: string | null;
    attachments: AttachmentInfo[];
    listUnsubscribe: string | null;
    listUnsubscribePost: string | null;
    /** With List-Unsubscribe, these mark mail sent to a list (shown on paper: utils/mailLook.ts). */
    listId: string | null;
    precedence: string | null;
}

export type FolderRole = 'inbox' | 'bucket' | 'archive' | 'sent' | 'drafts' | 'junk' | 'trash' | 'other';

export interface FolderInfo {
    path: string;
    role: FolderRole;
    count: number;
    unreadThreads: number;
}

export interface BucketView {
    name: string;
    path: string;
    color: string;
    emoji: string | null;
    sortOrder: number;
    showBadge: boolean;
    /** Its conversations also appear in Up next, above the Inbox. */
    showOnHome: boolean;
    /** "Archive threads older than N days" (null: off). */
    autoArchiveDays: number | null;
    count: number;
    unreadThreads: number;
}

/** Auto-archive sweeps not yet shown, combined (GET /accounts/:id/auto-archived). */
export interface SweepNotice {
    ids: number[];
    count: number;
    buckets: string[];
    /** False once a batch is over 7 days old (its items stay in Archive). */
    undoable: boolean;
}

export interface RuleView {
    id: string;
    senderPattern: string;
    /** Bucket name. */
    bucket: string;
    createdAt: string;
}

export type ConnectionState = 'stopped' | 'connecting' | 'online' | 'offline' | 'auth-failed';

export interface Account {
    id: string;
    email: string;
    displayName: string | null;
    /** The account's tab on the rail; null shows the part of the address before the @. */
    tabName: string | null;
    /** Plain text added under everything written from this account; null for none. */
    signature: string | null;
    inboxView: 'expand' | 'thread';
    hasSmtp: boolean;
    state: ConnectionState;
    error: string | null;
    lastSyncAt: string | null;
    /** While the password is refused: when the host first refused it, and when Mail logs in again. */
    rejectedAt: string | null;
    retryAt: string | null;
    stateToken: string;
}

export interface ServerSettings {
    host: string;
    port: number;
    secure: boolean;
    user: string;
}

export interface AccountSettings {
    id: string;
    email: string;
    displayName: string | null;
    tabName: string | null;
    signature: string | null;
    inboxView: 'expand' | 'thread';
    hasSmtp: boolean;
    imap: ServerSettings;
    smtp: ServerSettings | null;
}

/** Why the engine refused a server change or a new account: which server, and whether it was the password. */
export type ConnectionProblem = 'imap-refused' | 'imap' | 'smtp-refused' | 'smtp';

/** An address's servers, found from the address alone (Settings → Add an email account). */
export interface FoundServers {
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
}

/** What restoring a settings file did (Settings → Back up settings). */
export interface ImportSummary {
    updatedAccounts: string[];
    skippedAccounts: string[];
    buckets: number;
    rules: number;
    problems: string[];
}

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'saved' | 'failed' | 'uncertain';

export interface OutboxItem {
    id: string;
    accountId: string;
    messageId: string;
    subject: string | null;
    recipients: string[];
    status: OutboxStatus;
    attempts: number;
    error: string | null;
    draftKey: string | null;
    createdAt: string;
    sentAt: string | null;
    savedAt: string | null;
}

export interface UploadInfo {
    id: string;
    filename: string;
    contentType: string;
    size: number;
}

/** Up next on home: every conversation in the buckets shown on home, and every draft. */
export interface HomePage {
    state: string;
    buckets: { name: string; path: string; threads: ThreadCard[] }[];
    drafts: DraftSummary[];
}

export interface DraftSummary {
    msgKey: string;
    /** The conversation a reply draft belongs to; null for a new message. */
    threadId: string | null;
    subject: string | null;
    recipients: string[];
    date: string | null;
    preview: string | null;
}

export interface DraftContent {
    msgKey: string;
    /** Null for a draft written by another app (saving gives it one). */
    draftKey: string | null;
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    html: string | null;
    text: string | null;
    inReplyTo: string | null;
    references: string[];
    attachments: UploadInfo[];
    /** A reply written from another account: the account holding the message it answers. */
    originalAccount: string | null;
    /** A forward: the Message-ID (without <>) of the message it forwards. */
    forwardOf: string | null;
}

export interface TaskEvent {
    account: string;
    id: number;
    kind: 'moveThread' | 'undoMove' | 'setSeen';
    status: 'pending' | 'done' | 'failed' | 'cancelled';
    error: string | null;
}

export interface AuthStatus {
    enabled: boolean;
    configured: boolean;
    authenticated: boolean;
    user: { identifier: string } | null;
    /** 'door': the shared Bassapps sign-in (sign in on its own page; the apps menu). */
    mode?: 'door';
    /** Why this computer is signed out (the shared sign-in): 'everywhere', 'expired', … */
    reason?: string | null;
    /** The family of apps, for the apps menu (the shared sign-in, signed in). */
    family?: { apps: { id: string; name: string; url: string }[]; accountUrl: string; current: string } | null;
}
