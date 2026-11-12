// Finding an address's mail servers from the address alone, as Thunderbird's account setup does
// (https://wiki.mozilla.org/Thunderbird:Autoconfiguration): known providers first, then the
// domain's own SRV records (RFC 6186), then the provider behind its MX records, then the usual
// names (imap., mail., smtp.) on the usual ports. Nothing here logs in: a guess only has to
// answer on its port, and adding the account then signs in for real (manager.ts). No password
// goes anywhere until then.
import dns from 'node:dns/promises';
import net from 'node:net';

export interface FoundServer { host: string; port: number; secure: boolean }
export interface FoundServers { imap: FoundServer; smtp: FoundServer; via: 'provider' | 'srv' | 'mx' | 'guess' }

interface Provider { domains: RegExp; mx?: RegExp; imap: FoundServer; smtp: FoundServer }

const PROVIDERS: Provider[] = [
    { domains: /^(gmail|googlemail)\.com$/, mx: /(^|\.)(google|googlemail)\.com$/,
        imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
    { domains: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, mx: /(^|\.)(outlook|protection\.outlook)\.com$/,
        imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
    { domains: /^(yahoo|ymail)\.[a-z.]+$/, mx: /(^|\.)yahoodns\.net$/,
        imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
    { domains: /^(icloud|me|mac)\.com$/, mx: /(^|\.)icloud\.com$/,
        imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
    { domains: /^fastmail\.(com|fm)$/, mx: /(^|\.)messagingengine\.com$/,
        imap: { host: 'imap.fastmail.com', port: 993, secure: true }, smtp: { host: 'smtp.fastmail.com', port: 465, secure: true } },
];

/** What the lookups use; tests pass their own. */
export interface DiscoverTools {
    resolveSrv: (name: string) => Promise<{ name: string; port: number; priority: number; weight: number }[]>;
    resolveMx: (name: string) => Promise<{ exchange: string; priority: number }[]>;
    /** Whether something answers on host:port within a few seconds. */
    answers: (host: string, port: number) => Promise<boolean>;
}

const PROBE_MS = 4_000;

export const realTools: DiscoverTools = {
    resolveSrv: name => dns.resolveSrv(name),
    resolveMx: name => dns.resolveMx(name),
    answers: (host, port) => new Promise(resolve => {
        const socket = net.connect({ host, port });
        const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(PROBE_MS, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    }),
};

/** The servers for `email`, or null when none could be found (Settings then asks for them). */
export async function discoverServers(email: string, tools: DiscoverTools = realTools): Promise<FoundServers | null> {
    const domain = email.trim().toLowerCase().split('@')[1];
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;

    const known = knownProvider(domain);
    if (known) return { ...known, via: 'provider' };

    const [srv, mx] = await Promise.all([fromSrv(domain, tools), fromMx(domain, tools)]);
    if (srv) return { ...srv, via: 'srv' };
    if (mx) return { imap: mx.imap, smtp: mx.smtp, via: 'mx' };

    const [imap, smtp] = await Promise.all([
        first(tools, [`imap.${domain}`, `mail.${domain}`, domain].flatMap(host => [{ host, port: 993, secure: true }, { host, port: 143, secure: false }])),
        first(tools, [`smtp.${domain}`, `mail.${domain}`, domain].flatMap(host => [{ host, port: 465, secure: true }, { host, port: 587, secure: false }])),
    ]);
    return imap && smtp ? { imap, smtp, via: 'guess' } : null;
}

/** The servers of a well-known provider, by the address's domain (gmail.com, outlook.com, …). */
export function knownProvider(domain: string): { imap: FoundServer; smtp: FoundServer } | null {
    const p = PROVIDERS.find(x => x.domains.test(domain.toLowerCase()));
    return p ? { imap: p.imap, smtp: p.smtp } : null;
}

/** RFC 6186: _imaps / _imap and _submissions / _submission records (a target of "." means "none"). */
async function fromSrv(domain: string, tools: DiscoverTools): Promise<{ imap: FoundServer; smtp: FoundServer } | null> {
    const lookup = async (service: string, secure: boolean): Promise<FoundServer | null> => {
        const records = await tools.resolveSrv(`_${service}._tcp.${domain}`).catch(() => []);
        const best = records.filter(r => r.name && r.name !== '.').sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
        return best ? { host: best.name.replace(/\.$/, ''), port: best.port, secure } : null;
    };
    const [imaps, imap, submissions, submission] = await Promise.all([
        lookup('imaps', true), lookup('imap', false), lookup('submissions', true), lookup('submission', false),
    ]);
    const incoming = imaps ?? imap;
    const outgoing = submissions ?? submission;
    return incoming && outgoing ? { imap: incoming, smtp: outgoing } : null;
}

/** A domain whose mail a known provider handles (a company on Google Workspace, say). */
async function fromMx(domain: string, tools: DiscoverTools): Promise<Provider | null> {
    const records = await tools.resolveMx(domain).catch(() => []);
    const hosts = records.sort((a, b) => a.priority - b.priority).map(r => r.exchange.toLowerCase().replace(/\.$/, ''));
    return PROVIDERS.find(p => p.mx && hosts.some(h => p.mx!.test(h))) ?? null;
}

/** The first candidate, in order, that answers (all are tried at once). */
async function first(tools: DiscoverTools, candidates: FoundServer[]): Promise<FoundServer | null> {
    const answers = await Promise.all(candidates.map(c => tools.answers(c.host, c.port)));
    return candidates[answers.indexOf(true)] ?? null;
}
