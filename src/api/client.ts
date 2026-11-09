/**
 * The one way the UI talks to the engine (/api/v2). Every write is JSON and same-origin, which
 * the engine requires (it refuses anything a form on another site could forge); uploads send
 * raw bytes with the X-Requested-With header instead.
 */
import type { UploadInfo } from './types';
import { isGatewayFailure, reachability } from './reachability';

const BASE = '/api/v2';

export class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** Fired when the engine says the session is gone; App shows the login screen (or, with the shared
 * sign-in, the "signed out" dialog). Its detail says why, when the engine knows: { reason }. */
export const AUTH_REQUIRED_EVENT = 'em:auth-required';

/** Fired after logging in again once the session had ended: screens fetch again what failed meanwhile. */
export const SESSION_RESTORED_EVENT = 'em:session-restored';

/** Every engine response passes through here: "not logged in" from any call means the session ended. */
function noteSignedOut(status: number, path: string, reason?: string | null): void {
    if (status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason: reason ?? null } }));
}

const UNREACHABLE = "The app can't reach its server";

/** Whether the engine itself answered (any status), or a proxy answered for it because it's down. */
function noteReached(status: number, contentType: string | null): boolean {
    if (isGatewayFailure(status, contentType)) {
        reachability.failed();
        return false;
    }
    reachability.succeeded();
    return true;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(BASE + path, {
            method,
            credentials: 'same-origin',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        reachability.failed();
        throw new ApiError(0, UNREACHABLE);
    }
    if (!noteReached(res.status, res.headers.get('content-type'))) throw new ApiError(0, UNREACHABLE);
    const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
    if (!res.ok) {
        noteSignedOut(res.status, path, (data as { reason?: string } | null)?.reason);
        throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText);
    }
    return data as T;
}

export const api = {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
    put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
    patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
    // DELETE is a write too, so it carries a (empty) JSON body like the others.
    del: <T>(path: string) => request<T>('DELETE', path, {}),
};

const enc = encodeURIComponent;

/** Path prefix for one account's routes. */
export const acct = (accountId: string) => `/accounts/${enc(accountId)}`;

export const urls = {
    attachment: (accountId: string, msgKey: string, part: string) =>
        `${BASE}${acct(accountId)}/messages/${enc(msgKey)}/attachments/${part}`,
    exportSettings: `${BASE}/settings/export`,
    events: `${BASE}/events`,
};

export const paths = {
    thread: (accountId: string, threadId: string) => `${acct(accountId)}/threads/${enc(threadId)}`,
    body: (accountId: string, msgKey: string) => `${acct(accountId)}/messages/${enc(msgKey)}/body`,
    bucket: (accountId: string, name: string) => `${acct(accountId)}/buckets/${enc(name)}`,
    draft: (accountId: string, key: string) => `${acct(accountId)}/drafts/${enc(key)}`,
    outboxItem: (accountId: string, id: string) => `${acct(accountId)}/outbox/${enc(id)}`,
    forwardFiles: (accountId: string, msgKey: string) => `${acct(accountId)}/messages/${enc(msgKey)}/forward-files`,
};

/**
 * Streams one file to the engine; it is kept privately until a message or draft uses it.
 * XMLHttpRequest rather than fetch, for its upload progress (the line under a file chip).
 */
export function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<UploadInfo> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE}/uploads`);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-Requested-With', 'electronic-mail');
        xhr.setRequestHeader('X-Filename', enc(file.name));
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
        xhr.onerror = () => {
            reachability.failed();
            reject(new ApiError(0, UNREACHABLE));
        };
        xhr.onload = () => {
            if (!noteReached(xhr.status, xhr.getResponseHeader('content-type'))) {
                reject(new ApiError(0, UNREACHABLE));
                return;
            }
            let data: { upload?: UploadInfo; error?: string } | null = null;
            try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
            if (xhr.status < 200 || xhr.status >= 300) {
                noteSignedOut(xhr.status, '/uploads', (data as { reason?: string } | null)?.reason);
                reject(new ApiError(xhr.status, data?.error ?? xhr.statusText));
            } else resolve(data!.upload!);
        };
        xhr.send(file);
    });
}

/**
 * Saves a file the engine serves (an attachment, the settings export). It goes through fetch rather
 * than a plain link, so "not logged in" leads to the login screen instead of a file holding an error.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
    let res: Response;
    try {
        res = await fetch(url, { credentials: 'same-origin' });
    } catch {
        reachability.failed();
        throw new ApiError(0, UNREACHABLE);
    }
    if (!noteReached(res.status, res.headers.get('content-type'))) throw new ApiError(0, UNREACHABLE);
    if (!res.ok) {
        const data = await res.json().catch(() => null);
        noteSignedOut(res.status, url.slice(BASE.length), data?.reason);
        throw new ApiError(res.status, data?.error ?? res.statusText);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const named = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="([^"]+)"/i.exec(disposition)?.[1];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await res.blob());
    link.download = named ? decodeURIComponent(named) : fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** A plain-language message for any error thrown by the calls above. */
export function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
