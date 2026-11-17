/**
 * The design system v2 font candidates, round 2 (2026-11-12): Inter, Mona Sans, Instrument Sans and
 * Public Sans, self-hosted (@fontsource: Latin only, 400 and 500). Each file is its own asset, fetched
 * only when its font is chosen in the design trials: nothing here is in the normal bundle, and
 * nothing comes from Google at run time. All four are under the SIL Open Font License 1.1.
 */
import type { TrialFont } from './trialsState';

/** The page's own stack (styles/tokens.css, --font-ui) and the mail frame's (MailFrame.tsx). */
export const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const FRAME_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

type Candidate = Exclude<TrialFont, 'system'>;

/** A font file and the weights it serves (a @font-face font-weight range). */
interface FontFile { url: string; weight: string }

interface Face {
    label: string;
    /** Its own family name here, so it can't mix with the playground's variable fonts. */
    family: string;
    files: () => Promise<FontFile[]>;
}

/**
 * Two static files, each covering a range: 400 for the lighter weights, 500 for 500 and up. The
 * app's bold is 500, and Reader and mail ask for 600 and 700: the 500 file serves those as it is.
 */
const STATIC_WEIGHTS = ['1 449', '450 1000'];
const statics = (a: Promise<{ default: string }>, b: Promise<{ default: string }>) =>
    Promise.all([a, b]).then(mods => mods.map((m, i) => ({ url: m.default, weight: STATIC_WEIGHTS[i] })));

export const FACES: Record<Candidate, Face> = {
    inter: {
        label: 'Inter',
        family: 'Trial Inter',
        // Inter 4, the variable file with its optical-size axis (14–32): the browser sets it from the
        // text's size (font-optical-sizing: auto), so large text gets the display shapes. Its weight
        // axis is held to 400–500, the same two weights as the others: a bolder weight gets 500, and
        // the trials turn off synthetic bold (DesignTrials.tsx, MailFrame.tsx), so it's never faked.
        files: () => import('@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url')
            .then(m => [{ url: m.default, weight: '400 500' }]),
    },
    mona: {
        label: 'Mona Sans',
        family: 'Trial Mona Sans',
        files: () => statics(
            import('@fontsource/mona-sans/files/mona-sans-latin-400-normal.woff2?url'),
            import('@fontsource/mona-sans/files/mona-sans-latin-500-normal.woff2?url'),
        ),
    },
    instrument: {
        label: 'Instrument Sans',
        family: 'Trial Instrument Sans',
        files: () => statics(
            import('@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2?url'),
            import('@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2?url'),
        ),
    },
    public: {
        label: 'Public Sans',
        family: 'Trial Public Sans',
        files: () => statics(
            import('@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url'),
            import('@fontsource/public-sans/files/public-sans-latin-500-normal.woff2?url'),
        ),
    },
};

export interface LoadedFace { family: string; css: string }
const loaded = new Map<Candidate, Promise<LoadedFace>>();

/** A file as a data: address: the mail frame is sandboxed (another origin), so it can't fetch fonts
 * from Mail's address, but it may use ones written into its own styles. */
const dataUrl = (bytes: ArrayBuffer) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: 'font/woff2' }));
});

/** Loads a candidate into the page (once), and gives its @font-face rules for the mail frame. */
export function loadFace(key: Candidate): Promise<LoadedFace> {
    let face = loaded.get(key);
    if (!face) {
        const { family, files } = FACES[key];
        face = files().then(async list => {
            const bytes = await Promise.all(list.map(async ({ url }) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`${res.status}`);
                return res.arrayBuffer();
            }));
            await Promise.all(bytes.map(async (b, i) => {
                const f = new FontFace(family, b.slice(0), { weight: list[i].weight, style: 'normal', display: 'swap' });
                document.fonts.add(await f.load());
            }));
            const sources = await Promise.all(bytes.map(dataUrl));
            const css = sources.map((src, i) =>
                `@font-face{font-family:"${family}";src:url("${src}") format("woff2");font-weight:${list[i].weight};font-style:normal;font-display:block}`).join('');
            return { family, css };
        });
        face.catch(() => loaded.delete(key)); // a failed load can be tried again
        loaded.set(key, face);
    }
    return face;
}
