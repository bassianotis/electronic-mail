// Sender -> bucket rules. A rule's pattern is an exact address (as in the old app,
// case-insensitive) or "@domain" for a whole domain. Rules only act on mail that newly arrives
// in the Inbox (src/worker): a first sync or a cache rebuild never files old mail, and a message
// the user drags back to the Inbox is not filed again. Each filing is an ordinary, undoable move.
import crypto from 'node:crypto';
import type { AppDb } from './appDb.ts';

export interface Rule {
    id: string;
    senderPattern: string;
    bucket: string;
    createdAt: string;
}

export class RuleError extends Error {}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^@[^\s@]+\.[^\s@]+$/;

export class Rules {
    private readonly app: AppDb;

    constructor(app: AppDb) {
        this.app = app;
    }

    list(accountId: string): Rule[] {
        return (this.app.db.prepare('SELECT id, sender_pattern, bucket, created_at FROM rules WHERE account_id = ? ORDER BY created_at, rowid').all(accountId) as
            { id: string; sender_pattern: string; bucket: string; created_at: string }[])
            .map(r => ({ id: r.id, senderPattern: r.sender_pattern, bucket: r.bucket, createdAt: r.created_at }));
    }

    /** A new rule; `createdAt` puts one back where it was (Undo after deleting it). */
    add(accountId: string, senderPattern: string, bucket: string, createdAt?: string): Rule {
        const pattern = this.checked(accountId, senderPattern);
        const at = createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : new Date().toISOString();
        const rule = { id: crypto.randomUUID(), senderPattern: pattern, bucket, createdAt: at };
        this.app.db.prepare('INSERT INTO rules (id, account_id, sender_pattern, bucket, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(rule.id, accountId, rule.senderPattern, rule.bucket, rule.createdAt);
        return rule;
    }

    /** A rule changed in place (Settings → Sorting rules → Edit); null when there's no such rule. */
    update(accountId: string, id: string, senderPattern: string, bucket: string): Rule | null {
        const rule = this.list(accountId).find(r => r.id === id);
        if (!rule) return null;
        const pattern = this.checked(accountId, senderPattern, id);
        this.app.db.prepare('UPDATE rules SET sender_pattern = ?, bucket = ? WHERE account_id = ? AND id = ?').run(pattern, bucket, accountId, id);
        return { ...rule, senderPattern: pattern, bucket };
    }

    /** The pattern as stored, or why it can't be one (the words Settings shows under the field). */
    private checked(accountId: string, senderPattern: string, except?: string): string {
        const pattern = senderPattern.trim().toLowerCase();
        if (!ADDRESS.test(pattern) && !DOMAIN.test(pattern)) throw new RuleError('Use a full address (news@example.com) or a domain starting with @ (@example.com)');
        if (this.list(accountId).some(r => r.senderPattern === pattern && r.id !== except)) throw new RuleError(`There's already a rule for ${pattern}`);
        return pattern;
    }

    remove(accountId: string, id: string): boolean {
        return this.app.db.prepare('DELETE FROM rules WHERE account_id = ? AND id = ?').run(accountId, id).changes > 0;
    }
}

/** The bucket a sender's mail should go to, if any rule matches. Exact addresses beat domains. */
export function matchRule(rules: Pick<Rule, 'senderPattern' | 'bucket'>[], sender: string | null): string | null {
    if (!sender) return null;
    const address = sender.trim().toLowerCase();
    const exact = rules.find(r => r.senderPattern === address);
    if (exact) return exact.bucket;
    const domain = address.slice(address.lastIndexOf('@'));
    return rules.find(r => r.senderPattern === domain)?.bucket ?? null;
}
