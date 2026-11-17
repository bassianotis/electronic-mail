import React from 'react';

/**
 * A card's or row's subject as a link to its thread (rule K1), so Tab reaches every card and Enter
 * opens it, a one-message thread too. It looks exactly like the subject it holds; its card draws the
 * focus ring ([data-thread-card] in index.css). A click does what a click on the card does; with ⌘,
 * Ctrl or Shift it's an ordinary link (?thread=…, the app's own address for a thread).
 */
export const ThreadLink: React.FC<{ threadId: string; onOpen: () => void; children: React.ReactNode }> = ({ threadId, onOpen, children }) => (
    <a
        href={`?thread=${encodeURIComponent(threadId)}`}
        className="em-thread-link"
        data-thread-link=""
        draggable={false} // the card drags, never the link
        onClick={e => {
            e.stopPropagation(); // the card's own click would do it again
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onOpen();
        }}
    >
        {children}
    </a>
);
