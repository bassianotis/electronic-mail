/** Reply and forward subjects (compose.ts passes them on; on their own here so node's tests can load them). */

/** "Re: " once; a message with no subject gets "Re:" alone, with no space after (owner, Checkpoint C). */
export function replySubject(subject: string): string {
    if (!subject.trim()) return 'Re:';
    return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/** "Fwd: " once; with no subject, "Fwd:" alone (as "Re:"). */
export function forwardSubject(subject: string): string {
    if (!subject.trim()) return 'Fwd:';
    return /^(fwd?|fw):/i.test(subject.trim()) ? subject : `Fwd: ${subject}`;
}
