/**
 * What the screens show: a conversation's card, or one message inside a conversation.
 * Built from the engine's shapes by src/utils/emailMapper.ts.
 */
export interface Email {
    /** On a card: the conversation's id. Inside a conversation: the message's key. */
    id: string;
    /** The conversation it belongs to. */
    threadId: string;
    /** The message shown; its body and attachments load by this key. */
    msgKey: string;
    sender: string;
    senderAddress?: string;
    to?: EmailAddress[];
    cc?: EmailAddress[];
    /** Where replies go, when the sender set it (known once the body has loaded). */
    replyTo?: EmailAddress[];
    subject: string;
    /** A few lines of text ('' until the engine has read the message). */
    preview: string;
    /** HTML ('' until loaded). */
    body: string;
    date: Date;
    read: boolean;
    /** Folder the conversation lives in (Inbox, a bucket, Archive); null when it holds only mail you sent. */
    location: string | null;
    /** Messages in the conversation. */
    threadCount?: number;
    /** 'Sent' for a message you sent, or a conversation holding only mail you sent. */
    mailbox?: 'Sent';
    attachments?: Attachment[];
}

export interface EmailAddress {
    name?: string | null;
    address: string;
}

export interface Attachment {
    /** Where the attachment sits in the message (e.g. "2" or "1.2"). */
    part: string;
    filename: string;
    contentType: string;
    size: number | null;
}
