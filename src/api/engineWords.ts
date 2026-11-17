/**
 * The engine's refusals in plain words (design system v2, phase 3, item 1; rules W2–W4, A4). The
 * engine words its errors for its log and its tests; the screens show these instead. The ones that
 * can happen in normal use, or rarely (a race, another device, a server problem, the sign-in
 * service down: inventory 2, §4, 49 of 124), each have their own words. Everything else says only
 * what failed: "Couldn't <action>. Try again." (owner, Checkpoint C; `couldnt` in client.ts).
 *
 * Each is a clause, to follow "Couldn't …: " in a notice; `asSentence` makes one stand alone.
 */

/** Mail's own server didn't answer (or a proxy answered for it). */
export const UNREACHABLE = "the server isn't answering";

const SERVER: Record<string, string> = { Incoming: 'receiving server', Outgoing: 'sending server' };

type Words = string | ((m: RegExpExecArray) => string);

/** Why a receiving or sending server failed its check (the engine's explain(), manager.ts). */
const REASONS: [RegExp, string][] = [
    [/^the server rejected the username or password$/, "the server didn't accept the username or password"],
    [/^the server name was not found\b/, "there's no server by that name. Check the spelling"],
    [/^the server refused the connection\b/, 'the server refused the connection. Check the port'],
    [/^could not reach the server\b/, "couldn't reach the server. Check its name and the port"],
    [/^the secure connection failed: the server's certificate is not valid$/, "the server's security certificate isn't valid, so Mail didn't connect"],
    [/^the secure connection failed\b/, 'the secure connection failed. Try the other security setting or port'],
    [/^the connection failed$/, 'the connection failed'],
];
/** A known reason in plain words; otherwise the mail server's own words, as it said them. */
const reason = (why: string) => REASONS.find(([pattern]) => pattern.test(why))?.[1] ?? why;

// Engine wording → plain words, most specific first. The comments name inventory 2's rows.
const WORDS: [RegExp, Words][] = [
    // Signed out (1, 3; shown as the signed-out dialog, these only if something else shows it)
    [/^not (?:logged|signed) in$/, "you're signed out"],
    // The sign-in service down (16, 32)
    [/^the sign-in service isn't answering\b/, "the sign-in service isn't answering. Try again in a moment"],
    // The account, or its connection (15, 18, 20; 7; and a bucket action while it's offline)
    [/^unknown account\b/, 'that account is no longer in Mail'],
    [/^(\S+@\S+) is offline$/, m => `${m[1]} isn't connected to its mail server right now`],
    [/^\S+ is already set up$/, 'that account is already in Mail'],
    // Its servers, in Settings (35; 4; 8, 9, 10)
    [/^Outgoing mail \(SMTP\): a password is required$/, 'enter a password for the sending server'],
    [/^(Incoming|Outgoing) mail \((?:IMAP|SMTP)\): the username is required$/, m => `enter the username for the ${SERVER[m[1]]}`],
    [/^(?:Incoming|Outgoing) mail \((?:IMAP|SMTP)\): (.+)$/s, m => reason(m[1])],
    // Search (2)
    [/^search text is too long$/, "that's too long to search for. Try fewer words"],
    // Buckets (5; 21, 23, 29; 26, 27, 28)
    [/^a bucket called "(.+)" already exists$/, m => `there's already a bucket called “${m[1]}”`],
    [/^no bucket called "(.+)"$/, m => `there's no bucket called “${m[1]}” any more`],
    [/^this account has no Archive folder\b/, 'this account has no Archive folder to take its mail'],
    [/^the server refused to move ".+" to Archive; nothing was deleted$/, "the mail server wouldn't move its mail to the Archive, so nothing was deleted"],
    [/^".+" is not empty; nothing was deleted$/, 'it still has mail in it, so nothing was deleted. Try again'],
    // Sorting rules (12, 13: already in plain words, shown as they are; 22)
    [/^Use a full address \(.+\) or a domain starting with @ \(.+\)$/, m => m[0]],
    [/^There's already a rule for .+$/, m => m[0]],
    [/^rule not found$/, 'that rule is no longer there'],
    // Threads, messages, attachments and folders (24, 42; 39, 41; 40; 43, 46; 48, 49)
    [/^(?:thread not found|unknown thread\b.*)$/, 'that thread is no longer in your mailbox'],
    [/^message \S+ (?:is no longer on the server|not found)$/, 'that message is no longer on the mail server'],
    [/^attachment \S+ of \S+ not found$/, 'that attachment is no longer on the mail server'],
    [/^(?:unknown folder\b.*|folder .+ no longer exists on the server)$/, 'that folder is no longer on the mail server'],
    [/^server refused to change read state in /, "the mail server wouldn't mark it read or unread"],
    [/^server refused to move messages from /, "the mail server wouldn't move it"],
    // Undo (45; 25, 44, 47)
    [/^task \S+ is running; nothing to undo$/, "it's moving right now. Try again in a moment"],
    [/^task (?:not found|\S+ not found|\S+ is not a move|\S+ is \w+; nothing to undo)$/, "there's nothing left to undo"],
    // Drafts and sending (6, 33, 34; 11; 36, 37; 30, 31; 17, 19; 38)
    [/^that draft is no longer here$/, "it's no longer in Drafts. It may have been sent or deleted on another device"],
    [/^the server refused to save the draft$/, "the mail server wouldn't save the draft"],
    [/^this account has no Drafts folder$/, 'this account has no Drafts folder on its mail server'],
    [/^already sent$/, 'it was already sent'],
    [/^only failed or uncertain messages can be (?:sent again|discarded)$/, "it's already being sent, or was sent"],
    [/^the message you are replying to is no longer here$/, "the message you're replying to is no longer in your mailbox"],
    [/^the message you are replying to has no Message-ID\b/, "the message you're replying to can't be answered in its thread. Write a new message instead"],
    [/^attachments (?:together )?are limited to (\d+) MB$/, m => `attachments can't be more than ${m[1]} MB in all`],
    [/^that attachment is no longer available\b/, 'an attachment is no longer available. Attach it again'],
    // Back up settings (14)
    [/^this is not an Electronic Mail settings file$/, "that isn't a Mail settings file"],
];

/** The engine's words for a refusal, in plain words; anything else (and "internal error"),
 *  `otherwise`, or null: nothing to say beyond what failed. */
export function plainWords(message: string): string | null;
export function plainWords(message: string, otherwise: string): string;
export function plainWords(message: string, otherwise: string | null = null): string | null {
    const text = message.trim();
    for (const [pattern, words] of WORDS) {
        const m = pattern.exec(text);
        if (m) return typeof words === 'string' ? words : words(m);
    }
    return otherwise;
}

/** With no reason worth showing, a failure names what failed (owner, Checkpoint C). */
export const tryAgain = (action: string) => `Couldn't ${action}. Try again.`;

/** A failure in one line: "Couldn't <action>: <why>", or "Couldn't <action>. Try again." */
export const failedLine = (action: string, why: string | null) => (why ? `Couldn't ${action}: ${why}` : tryAgain(action));

/** A clause on its own: a capital letter and a full stop. */
export const asSentence = (clause: string) => {
    const text = clause.trim();
    if (!text) return text;
    const capital = text[0].toUpperCase() + text.slice(1);
    return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};
