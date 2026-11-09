// Shared helpers for tests against the Docker Dovecot harness (npm run harness:up).
import { ImapFlow } from 'imapflow';
import { randomUUID } from 'node:crypto';

export const HARNESS = {
    host: process.env.HARNESS_HOST || '127.0.0.1',
    port: Number(process.env.HARNESS_PORT || 11143),
};

// Each test gets its own empty mailbox: the static passdb accepts any username.
export function freshUser() {
    return `t-${randomUUID().slice(0, 8)}@test.local`;
}

export async function connect(user, options = {}) {
    const client = new ImapFlow({
        host: HARNESS.host,
        port: HARNESS.port,
        secure: false,
        auth: { user, pass: 'pass' },
        logger: false,
        ...options,
    });
    await client.connect();
    return client;
}

/**
 * @param {{ messageId?: string, subject?: string, from?: string, inReplyTo?: string, references?: string, date?: Date }} opts
 */
export function rawMessage({ messageId, subject = 'Test', from = 'a@example.com', inReplyTo, references, date = new Date() }) {
    const headers = [
        `From: ${from}`,
        'To: me@test.local',
        `Subject: ${subject}`,
        `Date: ${date.toUTCString()}`,
    ];
    if (messageId) headers.push(`Message-ID: ${messageId}`);
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references) headers.push(`References: ${references}`);
    return headers.join('\r\n') + '\r\n\r\nBody of ' + subject + '\r\n';
}
