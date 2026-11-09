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
 * inside the frame from the paper tokens; other mail takes the theme's text colours.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../utils/theme';
import { IMAGE_ICON } from '../../utils/remoteImages';

interface MailFrameProps {
    /** Sanitized HTML, placeholders already in (utils/remoteImages.ts). */
    html: string;
    /** On the lamplit sheet (mail with its own look) or in the theme's colours. */
    paper: boolean;
    /** Images may load from outside (after "Load images"). */
    imagesAllowed: boolean;
    fontSize: number;
    minHeight?: number;
    /** After "Load images": every image has loaded or failed (or 10 seconds passed). */
    onImagesSettled?: (failed: number) => void;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// The frame's one script (sizes, images, keys): public/mail-frame.js, from Mail's own address
const frameScript = () => `${window.location.origin}/mail-frame.js`;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function frameDocument(html: string, opts: { paper: boolean; imagesAllowed: boolean; fontSize: number; dark: boolean }): string {
    const { paper, imagesAllowed, fontSize, dark } = opts;
    const outside = imagesAllowed ? ' https: http:' : '';
    const policy = `default-src 'none'; script-src ${frameScript()}; style-src 'unsafe-inline'; img-src data:${outside}; font-src data:${outside}; media-src 'none'; base-uri 'none'; form-action 'none'`;
    // The lamplit sheet (dark) or the card itself (light), from the paper tokens
    const sheet = paper
        ? `background:${cssVar('--paper-bg')};color:${cssVar('--paper-text')};filter:${cssVar('--paper-filter')};padding:${cssVar('--paper-pad')};border-radius:${cssVar('--paper-radius')};width:${cssVar('--paper-width')};min-width:${cssVar('--paper-min-width')};max-width:100%;margin:${cssVar('--paper-margin')};box-shadow:${cssVar('--paper-shadow')};`
        : `color:${cssVar('--message-text')};`;
    const themeOnly = paper ? '' : `a{color:${cssVar('--message-link')};}` + (dark ? `::selection{background:color-mix(in srgb, ${cssVar('--color-action')} 35%, transparent);}` : '');
    const placeholder = paper
        ? 'background:#efebe3;border:1px dashed #cdc6b8;color:#8a857c;font:12px/1.3 Helvetica,Arial,sans-serif;gap:6px;'
        : `background:${cssVar(dark ? '--surface-card' : '--color-bg-subtle')};border:1px dashed ${dark ? 'rgba(237,237,237,0.18)' : 'rgba(0,0,0,0.18)'};border-radius:4px;color:${cssVar('--color-text-faint')};font:13px/1.3 ${FONT};gap:8px;margin:4px 0;`;
    // Room under the sheet for its shadow
    const extra = paper && dark ? 20 : 0;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>
:root{color-scheme:${dark ? 'dark' : 'light'};}
html,body{margin:0;padding:0;background:transparent;}
html{overflow-x:auto;overflow-y:hidden;}
body{font-family:${FONT};font-size:${fontSize}px;line-height:1.6;overflow-wrap:break-word;word-wrap:break-word;}
#em-root{box-sizing:border-box;${sheet}}
img{max-width:100%;height:auto;}
${themeOnly}
.em-ph{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;max-width:100%;vertical-align:middle;overflow:hidden;text-align:center;${placeholder}}
.em-ph svg{flex-shrink:0;}
.em-ph-label{max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
</style></head><body>
<div id="em-root" data-images="${imagesAllowed ? '1' : '0'}" data-look="${paper ? 'paper' : 'theme'}" data-extra="${extra}">${html}</div>
<template id="em-ph"><span class="em-ph" role="img" aria-label="Image didn't load">${IMAGE_ICON}</span></template>
<script src="${attr(frameScript())}"></script>
</body></html>`;
}

export const MailFrame: React.FC<MailFrameProps> = ({ html, paper, imagesAllowed, fontSize, minHeight = 0, onImagesSettled }) => {
    const dark = useTheme() === 'dark';
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(Math.max(minHeight, 80));
    const settled = useRef(onImagesSettled);
    useEffect(() => { settled.current = onImagesSettled; }, [onImagesSettled]);

    const srcDoc = useMemo(() => frameDocument(html, { paper, imagesAllowed, fontSize, dark }), [html, paper, imagesAllowed, fontSize, dark]);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!frame.current || e.source !== frame.current.contentWindow) return;
            const m = e.data as { em?: string; type?: string; height?: number; failed?: number; key?: string } | null;
            if (!m || m.em !== 'mail-frame') return;
            if (m.type === 'size' && typeof m.height === 'number') setHeight(Math.max(m.height, minHeight));
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
            style={{ display: 'block', width: '100%', height: `${height}px`, border: 0, background: 'transparent', colorScheme: dark ? 'dark' : 'light' }}
        />
    );
};
