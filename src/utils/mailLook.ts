/**
 * Whether a message's HTML brings its own look: a background (colour or image), images, or
 * coloured text too dark to read without a light page behind it. In the dark theme such mail keeps
 * its colours on a dimmed white sheet ("paper"). The rest (plain text, and the few-line HTML most
 * mail apps send) takes the theme's colours; its black and grey text, which Gmail signatures and
 * Apple Mail replies pin, becomes the theme's text colour (adoptThemeText), as Apple Mail's own
 * dark mode does. In light both look as they always have.
 */
export function hasOwnLook(html: string): boolean {
    if (BACKGROUND.test(html)) return true;
    for (const m of html.matchAll(COLOUR_DECLARATION)) if (needsLightPage(m[2])) return true;
    for (const m of html.matchAll(FONT_COLOUR)) if (needsLightPage(m[2])) return true;
    return false;
}

/** Mail shown in the dark theme's colours: black and grey text takes the theme's text colour. */
export function adoptThemeText(html: string): string {
    return html
        .replace(COLOUR_DECLARATION, (m, before: string, value: string) => (isNeutral(value) ? `${before}color: inherit` : m))
        .replace(FONT_COLOUR, (m, before: string, value: string) => (isNeutral(value) ? before : m));
}

const BACKGROUND = /<img\b|\bbgcolor\s*=|(?:^|[\s;"'{])background(?:-color|-image)?\s*:\s*(?!transparent|none|inherit|initial)/i;
const COLOUR_DECLARATION = /(^|[\s;"'{])color\s*:\s*([^;"'}<>]+)/gi;
const FONT_COLOUR = /(<font\b[^>]*?)\s*\bcolor\s*=\s*["']?([^"'\s>]+)["']?/gi;
const NEUTRAL_NAMES = /^(inherit|initial|unset|currentcolor|transparent|windowtext|black|white|silver|gr[ae]y|dimgr[ae]y|darkgr[ae]y|lightgr[ae]y|gainsboro|whitesmoke)$/;

function rgbOf(value: string): number[] | null {
    const v = value.trim().toLowerCase().replace(/\s*!important$/, '');
    const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    const fn = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    return fn ? fn.slice(1, 4).map(Number) : null;
}

/** Black, white or a grey: text the theme can recolour without changing what the sender meant. */
function isNeutral(value: string): boolean {
    if (NEUTRAL_NAMES.test(value.trim().toLowerCase().replace(/\s*!important$/, ''))) return true;
    const rgb = rgbOf(value);
    return !!rgb && Math.max(...rgb) - Math.min(...rgb) <= 24;
}

/** Coloured text below about 4:1 on the dark reading card, or a colour this can't read. */
function needsLightPage(value: string): boolean {
    if (isNeutral(value)) return false;
    const rgb = rgbOf(value);
    if (!rgb) return true;
    const [r, g, b] = rgb.map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2;
}
