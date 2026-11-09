// Appearance (the Instrument dark trial): the theme (Light or Dark), the font (System or Inter) and
// how a dragged card looks (Current or New, in dark), each remembered per browser. index.html applies the saved choices before the first paint, so a
// reload doesn't flash; Settings changes them.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export type Font = 'system' | 'inter';
export type DragStyle = 'current' | 'new';

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};

/** Sets <html data-{name}> (absent for the default) and remembers it as mail_{name}. */
function choose(name: 'theme' | 'font' | 'drag', value: string, fallback: string): void {
    if (value === fallback) delete document.documentElement.dataset[name];
    else document.documentElement.dataset[name] = value;
    try {
        localStorage.setItem(`mail_${name}`, value);
    } catch {
        // Storage blocked: the choice lasts until the page reloads.
    }
    for (const l of listeners) l();
}

export const setTheme = (theme: Theme) => choose('theme', theme, 'light');
export const setFont = (font: Font) => choose('font', font, 'system');
export const setDragStyle = (drag: DragStyle) => choose('drag', drag, 'current');

export function useTheme(): Theme {
    return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
}

export function useFont(): Font {
    return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.font === 'inter' ? 'inter' : 'system'));
}

export function useDragStyle(): DragStyle {
    return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.drag === 'new' ? 'new' : 'current'));
}
