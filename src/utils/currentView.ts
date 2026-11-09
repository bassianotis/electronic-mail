/**
 * The conversation on screen, so "Sign in again" can come back to this exact view (the address
 * bar doesn't follow it). App keeps it up to date.
 */
let openThread: string | null = null;

export const setOpenThread = (threadId: string | null) => { openThread = threadId; };

/** Where to come back to: the open conversation, or home. */
export const returnPath = () => (openThread ? `/?thread=${encodeURIComponent(openThread)}` : '/');
