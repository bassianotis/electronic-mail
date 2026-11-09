// Files the user attaches while composing. Stored privately under DATA_DIR/uploads until the
// message (or draft) that uses them is sent; anything older than a week is cleaned up.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { OutgoingAttachment } from './compose.ts';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f-]{36}$/;

export interface UploadInfo {
    id: string;
    filename: string;
    contentType: string;
    size: number;
}

export class UploadError extends Error {}

export class Uploads {
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    /** Streams to disk, refusing anything over MAX_UPLOAD_BYTES. */
    async save(source: Readable, filename: string, contentType: string): Promise<UploadInfo> {
        const id = crypto.randomUUID();
        const file = path.join(this.dir, id);
        let size = 0;
        const out = fs.createWriteStream(file, { mode: 0o600 });
        try {
            for await (const chunk of source) {
                size += (chunk as Buffer).length;
                if (size > MAX_UPLOAD_BYTES) throw new UploadError(`attachments are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
                if (!out.write(chunk)) await new Promise<void>(r => out.once('drain', () => r()));
            }
            await new Promise<void>((resolve, reject) => {
                out.once('error', reject);
                out.end(() => resolve());
            });
        } catch (err) {
            out.destroy();
            fs.rmSync(file, { force: true });
            throw err;
        }
        const info: UploadInfo = { id, filename: cleanName(filename), contentType: cleanType(contentType), size };
        fs.writeFileSync(`${file}.json`, JSON.stringify(info), { mode: 0o600 });
        return info;
    }

    /** Stores bytes we already have (e.g. a forwarded message's attachment). */
    saveBuffer(content: Buffer, filename: string, contentType: string): UploadInfo {
        const id = crypto.randomUUID();
        fs.writeFileSync(path.join(this.dir, id), content, { mode: 0o600 });
        const info: UploadInfo = { id, filename: cleanName(filename), contentType: cleanType(contentType), size: content.length };
        fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(info), { mode: 0o600 });
        return info;
    }

    info(id: string): UploadInfo {
        if (!ID.test(id)) throw new UploadError('unknown attachment');
        try {
            return JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8')) as UploadInfo;
        } catch {
            throw new UploadError('that attachment is no longer available; please attach it again');
        }
    }

    load(id: string): OutgoingAttachment {
        const info = this.info(id);
        return { filename: info.filename, contentType: info.contentType, content: fs.readFileSync(path.join(this.dir, id)) };
    }

    remove(id: string): void {
        if (!ID.test(id)) return;
        fs.rmSync(path.join(this.dir, id), { force: true });
        fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
    }

    /** Removes uploads older than a week (abandoned compositions). */
    cleanup(now = Date.now()): number {
        let removed = 0;
        for (const name of fs.readdirSync(this.dir)) {
            if (!ID.test(name)) continue;
            if (now - fs.statSync(path.join(this.dir, name)).mtimeMs > MAX_AGE_MS) {
                this.remove(name);
                removed++;
            }
        }
        return removed;
    }
}

function cleanName(name: string): string {
    const base = path.basename(name.replace(/\\/g, '/')).replace(/[\r\n\0]/g, '').trim();
    return base.slice(0, 200) || 'attachment';
}

function cleanType(type: string): string {
    return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type.toLowerCase() : 'application/octet-stream';
}
