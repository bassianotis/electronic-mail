/**
 * Design trials (?trials): the owner's tool for trying the design system v2 font candidates in the
 * real app, not a user setting. This small part is in the normal bundle: it reads what this browser
 * chose, and holds the letter font the mail frame uses. The panel and the fonts themselves load only
 * when wanted (DesignTrials.tsx, trialFonts.ts), so the normal bundle carries no font.
 */
import { useSyncExternalStore } from 'react';

export type TrialFont = 'system' | 'inter' | 'mona' | 'instrument' | 'public';
/** Letter text: the interface's font, or the system font whatever the interface uses. */
export type LetterChoice = 'interface' | 'system';

export interface TrialChoices {
    font: TrialFont;
    letter: LetterChoice;
    /** The panel stays open across reloads until it's closed. */
    open: boolean;
}

const KEY = 'designTrials';
// Round 1's choices (plex, source, atkinson) are gone: one still stored reads as System
const FONTS: TrialFont[] = ['system', 'inter', 'mona', 'instrument', 'public'];
export const NO_TRIALS: TrialChoices = { font: 'system', letter: 'interface', open: false };

/** This browser's choices; with nothing stored (or no storage), System. */
export function readTrials(): TrialChoices {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TrialChoices> | null;
        if (!saved) return NO_TRIALS;
        return {
            font: FONTS.includes(saved.font as TrialFont) ? saved.font as TrialFont : 'system',
            letter: saved.letter === 'system' ? 'system' : 'interface',
            open: saved.open === true,
        };
    } catch {
        return NO_TRIALS;
    }
}

export function writeTrials(choices: TrialChoices): void {
    try {
        if (choices.font === 'system' && choices.letter === 'interface' && !choices.open) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, JSON.stringify(choices));
    } catch { /* a private window: this page only */ }
}

/** Whether to load the trials at all: asked for in the address, left open, or a font still chosen. */
export function trialsWanted(): boolean {
    const t = readTrials();
    return new URLSearchParams(window.location.search).has('trials') || t.open || t.font !== 'system';
}

/** The font mail is set in (theme mail, plain text, Reader), when a trial changes it. */
export interface LetterFont {
    /** The CSS font-family list. */
    family: string;
    /** Its @font-face rules, the files written in (data:), which the frame's policy already allows. */
    faces: string;
}

let letterFont: LetterFont | null = null;
const listeners = new Set<() => void>();

export function setLetterFont(next: LetterFont | null): void {
    letterFont = next;
    listeners.forEach(l => l());
}

/** The trial's letter font, or null (the frame's own system font, as without trials). */
export function useLetterFont(): LetterFont | null {
    return useSyncExternalStore(
        l => { listeners.add(l); return () => listeners.delete(l); },
        () => letterFont,
    );
}
