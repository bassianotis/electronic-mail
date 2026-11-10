/**
 * An email's body, in a sandboxed frame (docs/architecture.md, rule 10, and Security).
 * - Its own opaque origin (no allow-same-origin): nothing in it can reach the app, its cookies or
 *   its API.
 * - Its own content policy: nothing loads from outside until the person loads images for this
 *   message (then images and fonts may). Styles are inline only. The one script allowed is ours,
 *   public/mail-frame.js, by its exact address (the page's own policy, which the frame inherits,
 *   allows no inline script); the email's own scripts are stripped (DOMPurify) and couldn't run anyway.
 * - Links open in a new tab, and no address is sent along as the referrer.
 * Our script reports the body's height (the frame has no scrollbar: the card scrolls), when its
 * images have loaded (an image that fails gets its placeholder back), and Escape and the arrow keys
 * (the reading view's shortcuts). HTML mail with its own look sits on the lamplit sheet, drawn
 * inside the frame from the paper tokens; other mail takes the theme's text colours. Reader is in a
 * frame too, with its own type, so the same policy keeps outside content out of it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IMAGE_ICON, type PlaceholderLook } from '../../utils/remoteImages';

interface MailFrameProps {
    /** Sanitized HTML, placeholders already in (utils/remoteImages.ts). */
    html: string;
    /** On the lamplit sheet (mail with its own look), in the theme's colours, or as Reader. */
    look: PlaceholderLook;
    /** Images may load from outside (after "Load images"). */
    imagesAllowed: boolean;
    fontSize: number;
    minHeight?: number;
    /** After "Load images": every image has loaded or failed (or 10 seconds passed). */
    onImagesSettled?: (failed: number) => void;
    /** Where the paper sheet starts, from the frame's left edge (to line things up under it). */
    onSheetLeft?: (left: number) => void;
    /** The email's own @font-face rules (Original only: utils/mailLook.ts, fontFaces). */
    fonts?: string;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// The frame's one script (sizes, images, keys): public/mail-frame.js, from Mail's own address
const frameScript = () => `${window.location.origin}/mail-frame.js`;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Links and quote bars in theme mail and Reader: in the text colour, never amber (Part 4). */
function linkStyles(link: string, underline: string, quoteBar: string): string {
    return `a{color:${link};text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:${underline};text-underline-offset:2px;}
a:hover{text-decoration-color:${link};}
blockquote{border-left:2px solid ${quoteBar};}`;
}

/** Reader's type (once in the page, now in the frame): the email's own styles are gone. */
function readerStyles(): string {
    return `#em-root{color:${cssVar('--reader-text')};}
body{font-size:${cssVar('--font-size-lg')};line-height:1.7;}
p{margin:0 0 1.4em;}
h1,h2,h3,h4,h5,h6{margin:1.5em 0 0.75em;font-weight:600;line-height:1.3;}
h1{font-size:2em;}h2{font-size:1.75em;}h3{font-size:1.5em;}h4{font-size:1.25em;}h5{font-size:1.1em;}h6{font-size:1em;}
${linkStyles(cssVar('--reader-link'), cssVar('--reader-link-underline'), cssVar('--reader-quote-bar'))}
strong,b{font-weight:600;}
#em-root :not(em, i, em *, i *){font-style:normal;}
em,i{font-style:italic;}
blockquote{margin:1.5em 0;padding-left:1.5em;}
img{margin:2em auto;border-radius:8px;display:block;}
ul,ol{margin:1em 0;padding-left:2em;}
li{margin-bottom:0.5em;}
table{border-collapse:collapse;width:100%;margin:0 0 1.4em;}
td,th{padding:6px 8px;text-align:left;vertical-align:top;border-bottom:1px solid ${cssVar('--reader-rule')};}`;
}

function frameDocument(html: string, opts: { look: PlaceholderLook; imagesAllowed: boolean; fontSize: number; fonts: string }): string {
    const { look, imagesAllowed, fontSize, fonts } = opts;
    const paper = look === 'paper';
    const outside = imagesAllowed ? ' https: http:' : '';
    const policy = `default-src 'none'; script-src ${frameScript()}; style-src 'unsafe-inline'; img-src data:${outside}; font-src data:${outside}; media-src 'none'; base-uri 'none'; form-action 'none'`;
    // The lamplit sheet fills the card, and the email sits centred on it at its own width. A design
    // wider than the card scrolls inside the sheet rather than shrinking.
    const sheet = paper
        ? `background:${cssVar('--paper-bg')};color:${cssVar('--paper-text')};filter:${cssVar('--paper-filter')};padding:${cssVar('--paper-pad')};border-radius:${cssVar('--paper-radius')};width:${cssVar('--paper-width')};min-width:${cssVar('--paper-min-width')};max-width:100%;overflow-x:auto;margin:${cssVar('--paper-margin')};box-shadow:${cssVar('--paper-shadow')};`
        : look === 'reader' ? '' : `color:${cssVar('--message-text')};`;
    const selection = `::selection{background:color-mix(in srgb, ${cssVar('--color-action')} 35%, transparent);}`;
    const lookStyles = look === 'reader' ? readerStyles() + selection
        : look === 'theme' ? linkStyles(cssVar('--message-link'), cssVar('--link-underline'), cssVar('--quote-bar')) + 'blockquote{margin:0.5em 0;padding-left:12px;}table{max-width:100%;}' + selection
        : '';
    const placeholder = paper
        ? 'background:#efebe3;border:1px dashed #cdc6b8;color:#8a857c;font:12px/1.3 Helvetica,Arial,sans-serif;gap:6px;'
        : look === 'reader'
        ? `background:${cssVar('--surface-card')};border:1px dashed color-mix(in srgb, ${cssVar('--color-text-main')} 18%, transparent);border-radius:4px;color:${cssVar('--color-text-faint')};font:13px/1.3 ${FONT};gap:8px;margin:4px 0;`
        : `background:${cssVar('--surface-card')};border:1px dashed rgba(237,237,237,0.18);border-radius:4px;color:${cssVar('--color-text-faint')};font:13px/1.3 ${FONT};gap:8px;margin:4px 0;`;
    // A one-line chip for an image of unknown or small size: secondary text, a hairline at 13%
    const chip = paper
        ? 'background:transparent;border:1px solid rgba(0,0,0,0.13);color:#8a857c;font:13px/1 Helvetica,Arial,sans-serif;'
        : look === 'reader'
        ? `background:transparent;border:1px solid color-mix(in srgb, ${cssVar('--reader-text')} 13%, transparent);color:${cssVar('--reader-muted')};font:13px/1 ${FONT};`
        : `background:transparent;border:1px solid ${cssVar('--border-strong')};color:${cssVar('--color-text-muted')};font:13px/1 ${FONT};`;
    // Room under the sheet for its shadow
    const extra = paper ? 20 : 0;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>
:root{color-scheme:dark;}
html,body{margin:0;padding:0;background:transparent;}
html{overflow-x:auto;overflow-y:hidden;}
body{font-family:${FONT};font-size:${fontSize}px;line-height:1.6;overflow-wrap:break-word;word-wrap:break-word;}
#em-root{box-sizing:border-box;${sheet}}
img{max-width:100%;height:auto;}
${lookStyles}
${fonts}
.em-fit{width:fit-content;max-width:100%;margin:0 auto;}
.em-ph{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;max-width:100%;vertical-align:middle;overflow:hidden;text-align:center;text-transform:none;letter-spacing:normal;font-style:normal;font-weight:normal;text-decoration:none;text-indent:0;${placeholder}}
.em-ph.em-chip{flex-direction:row;height:28px;padding:0 10px;gap:6px;margin:2px 0;border-radius:6px;max-width:100%;${chip}}
.em-ph svg{flex-shrink:0;}
.em-ph-label{max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.em-chip .em-ph-label{max-width:240px;min-width:0;}
.em-ph.em-chip-icon{padding:0;gap:0;justify-content:center;}
</style></head><body>
<div id="em-root" data-images="${imagesAllowed ? '1' : '0'}" data-look="${look}" data-extra="${extra}">${paper ? `<div class="em-fit">${html}</div>` : html}</div>
<template id="em-ph"><span class="em-ph" role="img" aria-label="Image didn't load">${IMAGE_ICON}</span></template>
<script src="${attr(frameScript())}"></script>
</body></html>`;
}

export const MailFrame: React.FC<MailFrameProps> = ({ html, look, imagesAllowed, fontSize, minHeight = 0, onImagesSettled, onSheetLeft, fonts = '' }) => {
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(Math.max(minHeight, 80));
    const settled = useRef(onImagesSettled);
    useEffect(() => { settled.current = onImagesSettled; }, [onImagesSettled]);
    const sheetLeft = useRef(onSheetLeft);
    useEffect(() => { sheetLeft.current = onSheetLeft; }, [onSheetLeft]);

    const srcDoc = useMemo(() => frameDocument(html, { look, imagesAllowed, fontSize, fonts }), [html, look, imagesAllowed, fontSize, fonts]);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!frame.current || e.source !== frame.current.contentWindow) return;
            const m = e.data as { em?: string; type?: string; height?: number; left?: number; failed?: number; key?: string } | null;
            if (!m || m.em !== 'mail-frame') return;
            if (m.type === 'size' && typeof m.height === 'number') {
                setHeight(Math.max(m.height, minHeight));
                if (typeof m.left === 'number') sheetLeft.current?.(m.left);
            }
            else if (m.type === 'images') settled.current?.(typeof m.failed === 'number' ? m.failed : 0);
            else if (m.type === 'key' && typeof m.key === 'string') window.dispatchEvent(new KeyboardEvent('keydown', { key: m.key }));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [minHeight]);

    return (
        <iframe
            ref={frame}
            title="Message"
            data-email-frame
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            style={{ display: 'block', width: '100%', height: `${height}px`, border: 0, background: 'transparent', colorScheme: 'dark' }}
        />
    );
};
