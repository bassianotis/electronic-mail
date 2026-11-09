/**
 * Parsing email HTML without loading anything: an element of the page's own document starts
 * fetching its images (tracking pixels included) as soon as it's given HTML, even when it's never
 * shown. An element of a separate, inert document doesn't.
 */
let inert: Document | null = null;

/** A detached div holding `html`, parsed where nothing loads. */
export function inertDiv(html: string): HTMLDivElement {
    inert ??= document.implementation.createHTMLDocument('');
    const div = inert.createElement('div');
    div.innerHTML = html;
    return div;
}
