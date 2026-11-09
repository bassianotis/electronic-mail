// The app's own notices to the person (today: the new sign-in email). They're sent from and to the
// person's own account, and a sender rule must never file one into a bucket: they always land in the
// Inbox. Each carries a Message-ID only this engine can make (a keyed hash of a random part, keyed
// from secret.key), so mail from anyone else can't pass for one to get past the rules.
import crypto from 'node:crypto';

export class NoticeIds {
    private readonly key: Buffer;

    constructor(secretKey: Buffer) {
        this.key = crypto.createHmac('sha256', secretKey).update('electronic-mail notice ids').digest();
    }

    private mac(part: string): string {
        return crypto.createHmac('sha256', this.key).update(part).digest('base64url').slice(0, 22);
    }

    /** A new Message-ID for a notice sent from `address` (its domain on the right, as mail servers expect). */
    make(address: string): string {
        const part = crypto.randomBytes(12).toString('base64url');
        return `<notice.${part}.${this.mac(part)}@${address.split('@')[1] || 'localhost'}>`;
    }

    /** Whether a Message-ID (with or without its angle brackets) is one of this engine's notices. */
    isOwn(messageId: string | null | undefined): boolean {
        const m = /^<?notice\.([\w-]+)\.([\w-]+)@/.exec(messageId ?? '');
        if (!m) return false;
        const want = Buffer.from(this.mac(m[1]));
        const got = Buffer.from(m[2]);
        return want.length === got.length && crypto.timingSafeEqual(want, got);
    }
}
