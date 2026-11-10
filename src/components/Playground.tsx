/**
 * The design playground (?playground in the address): a floating panel of live controls that write
 * CSS variables on this page only, to try values before they're decided. Nothing is saved: Reset or a
 * reload puts everything back. App.tsx loads it (and IBM Plex Sans and Source Sans 3 with it) only with the flag.
 * Easing sets --ease, the one curve every CSS transition uses; the framer-motion animations keep theirs
 * (utils/motion.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/source-sans-3';

type Kind = 'colour' | 'px' | 'select';
interface Control {
    key: string;
    group: string;
    label: string;
    kind: Kind;
    /** The variables it writes (darkVars: more it writes alongside) */
    vars: string[];
    darkVars?: string[];
    min?: number;
    max?: number;
    options?: [string, string][];
}

const SYSTEM = 'system-ui, -apple-system, sans-serif';
const FONTS: [string, string][] = [
    [SYSTEM, 'System'],
    [`'Inter Variable', ${SYSTEM}`, 'Inter'],
    [`'IBM Plex Sans Variable', ${SYSTEM}`, 'IBM Plex Sans'],
    [`'Source Sans 3 Variable', ${SYSTEM}`, 'Source Sans 3'],
];
const EASINGS: [string, string][] = [
    ['', 'As built (quint out)'],
    ['cubic-bezier(0.16, 1, 0.3, 1)', 'Expo out'],
    ['cubic-bezier(0.2, 0, 0, 1)', 'Standard'],
    ['ease-out', 'ease-out'],
    ['ease', 'ease'],
    ['linear', 'linear'],
];
const CONTROLS: Control[] = [
    { group: 'Surfaces', key: 'page', label: 'Page', kind: 'colour', vars: ['--color-bg'] },
    { group: 'Surfaces', key: 'card', label: 'Card', kind: 'colour', vars: ['--surface-card'] },
    { group: 'Surfaces', key: 'raised', label: 'Raised', kind: 'colour', vars: ['--surface-raised'] },
    { group: 'Text', key: 'text', label: 'Primary', kind: 'colour', vars: ['--color-text-main'] },
    { group: 'Text', key: 'muted', label: 'Secondary', kind: 'colour', vars: ['--color-text-muted'] },
    { group: 'Text', key: 'faint', label: 'Faint', kind: 'colour', vars: ['--color-text-faint'] },
    { group: 'Accent', key: 'accent', label: 'Accent', kind: 'colour', vars: ['--color-action'] },
    { group: 'Shape', key: 'cardRadius', label: 'Card radius', kind: 'px', min: 0, max: 24, vars: ['--radius-md'] },
    { group: 'Shape', key: 'controlRadius', label: 'Control radius', kind: 'px', min: 0, max: 16, vars: ['--radius-control', '--radius-sm'], darkVars: ['--radius-pill'] },
    { group: 'Shape', key: 'cardPad', label: 'Card padding', kind: 'px', min: 8, max: 40, vars: ['--card-pad'] },
    { group: 'Type', key: 'font', label: 'Font', kind: 'select', vars: ['--font-family'], options: FONTS },
    { group: 'Type', key: 'base', label: 'Base text size', kind: 'px', min: 12, max: 20, vars: ['--base-size'] },
    { group: 'Motion', key: 'ease', label: 'Easing', kind: 'select', vars: ['--ease'], options: EASINGS },
];

const root = () => document.documentElement;

/** A variable's colour as #rrggbb, read through a probe so var() chains and rgb() resolve. */
function readColour(name: string): string {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const rgb = (getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3);
    probe.remove();
    return '#' + rgb.map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
}

/** A length variable in px (read as a probe's width), or the page's text size for --base-size. */
function readPx(name: string): number {
    if (name === '--base-size') return parseFloat(getComputedStyle(root()).fontSize);
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return Math.round(px);
}

/** Which of the three the page uses now: the bundled faces by their "Variable" names (the System
 * default names 'Inter' first, which isn't installed, so the system font shows). */
function readFont(): string {
    const family = getComputedStyle(root()).getPropertyValue('--font-family');
    return FONTS.find(([value, label]) => label !== 'System' && family.includes(value.split(',')[0].replace(/'/g, '')))?.[0] ?? SYSTEM;
}

/** Today's values (nothing from the playground on the page). */
function readDefaults(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of CONTROLS) {
        if (c.kind === 'colour') out[c.key] = readColour(c.vars[0]);
        else if (c.kind === 'px') out[c.key] = String(readPx(c.vars[0]));
        else out[c.key] = c.key === 'font' ? readFont() : '';
    }
    return out;
}

const cssValue = (c: Control, v: string) => (c.kind === 'px' ? `${v}px` : v);

export default function Playground() {
    const [open, setOpen] = useState(true);
    const [defaults, setDefaults] = useState<Record<string, string>>({});
    const [changed, setChanged] = useState<Record<string, string>>({});
    const [snippet, setSnippet] = useState<string | null>(null);

    const varsOf = useCallback((c: Control) => [...c.vars, ...(c.darkVars ?? [])], []);

    // Today's values, read with the playground's own values lifted for a moment
    useEffect(() => {
        const saved = CONTROLS.flatMap(c => [...c.vars, ...(c.darkVars ?? [])]).map(v => [v, root().style.getPropertyValue(v)] as const);
        for (const [v] of saved) root().style.removeProperty(v);
        setDefaults(readDefaults()); // eslint-disable-line react-hooks/set-state-in-effect -- read off the page as it is
        for (const [v, value] of saved) if (value) root().style.setProperty(v, value);
    }, []);

    const set = (c: Control, value: string) => {
        setChanged(prev => ({ ...prev, [c.key]: value }));
        setSnippet(null);
        for (const v of varsOf(c)) {
            if (value) root().style.setProperty(v, cssValue(c, value));
            else root().style.removeProperty(v); // Easing: As built
        }
    };

    const reset = () => {
        for (const c of CONTROLS) for (const v of [...c.vars, ...(c.darkVars ?? [])]) root().style.removeProperty(v);
        setChanged({});
        setSnippet(null);
        setDefaults(readDefaults());
    };

    const copy = () => {
        const lines = CONTROLS.filter(c => changed[c.key] !== undefined && changed[c.key] !== defaults[c.key]).flatMap(c =>
            c.key === 'ease'
                ? changed.ease ? [`    /* one curve for every transition */`, `    --ease: ${changed.ease};`] : []
                : varsOf(c).map(v => `    ${v}: ${cssValue(c, changed[c.key])};`));
        const text = lines.length ? `/* Design playground */\n:root {\n${lines.join('\n')}\n}` : '/* Design playground: nothing changed */';
        setSnippet(text);
        navigator.clipboard?.writeText(text).catch(() => {});
    };

    const value = (c: Control) => changed[c.key] ?? defaults[c.key] ?? '';
    const groups = [...new Set(CONTROLS.map(c => c.group))];

    return (
        <div role="dialog" aria-label="Design playground" style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? '8px' : 0 }}>
                <strong style={{ fontSize: '12px', fontWeight: 600 }}>Design playground</strong>
                <button type="button" onClick={() => setOpen(!open)} style={smallButton} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
            </div>
            {open && (
                <>
                    {groups.map(group => (
                        <fieldset key={group} style={{ border: 0, margin: '0 0 8px', padding: 0 }}>
                            <legend style={{ color: '#8b8e96', fontSize: '11px', padding: 0, marginBottom: '4px' }}>{group}</legend>
                            {CONTROLS.filter(c => c.group === group).map(c => (
                                <label key={c.key} style={row}>
                                    <span style={{ flex: '0 0 96px' }}>{c.label}</span>
                                    {c.kind === 'colour' && (
                                        <>
                                            <input type="color" aria-label={c.label} value={value(c) || '#000000'} onChange={e => set(c, e.target.value)} style={swatch} />
                                            <code style={{ fontSize: '11px', color: changed[c.key] ? '#f0c27a' : '#b4b7be' }}>{value(c)}</code>
                                        </>
                                    )}
                                    {c.kind === 'px' && (
                                        <>
                                            <input type="range" aria-label={c.label} min={c.min} max={c.max} step={1} value={Number(value(c)) || 0} onChange={e => set(c, e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                                            <code style={{ width: '36px', textAlign: 'right', fontSize: '11px', color: changed[c.key] ? '#f0c27a' : '#b4b7be' }}>{value(c)}px</code>
                                        </>
                                    )}
                                    {c.kind === 'select' && (
                                        <select aria-label={c.label} value={value(c)} onChange={e => set(c, e.target.value)} style={select}>
                                            {c.options!.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
                                        </select>
                                    )}
                                </label>
                            ))}
                        </fieldset>
                    ))}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button type="button" onClick={reset} style={button}>Reset</button>
                        <button type="button" onClick={copy} style={button}>Copy values</button>
                    </div>
                    {snippet && <pre aria-label="Copied values" style={pre}>{snippet}</pre>}
                    <p style={{ margin: '8px 0 0', color: '#8b8e96', fontSize: '11px', lineHeight: 1.4 }}>On this page only; nothing is saved. Easing changes CSS transitions, not the card animations.</p>
                </>
            )}
        </div>
    );
}

// Its own look, so it stays readable whatever the controls do to the app
const panel: React.CSSProperties = {
    position: 'fixed', top: '72px', right: '16px', zIndex: 10001, width: '300px', maxHeight: 'calc(100vh - 96px)', overflowY: 'auto',
    boxSizing: 'border-box', padding: '12px', borderRadius: '10px', background: 'rgba(24, 25, 28, 0.97)', border: '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: '0 14px 40px rgba(0, 0, 0, 0.5)', color: '#e6e6e6', fontFamily: SYSTEM, fontSize: '12px', lineHeight: 1.3,
};
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '28px' };
const swatch: React.CSSProperties = { width: '28px', height: '20px', padding: 0, border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '4px', background: 'none', cursor: 'pointer' };
const select: React.CSSProperties = { flex: 1, minWidth: 0, height: '24px', fontSize: '12px', fontFamily: SYSTEM, color: '#e6e6e6', background: '#2a2b30', border: '1px solid rgba(255, 255, 255, 0.16)', borderRadius: '4px' };
const button: React.CSSProperties = { flex: 1, height: '28px', fontSize: '12px', fontFamily: SYSTEM, color: '#e6e6e6', background: '#2a2b30', border: '1px solid rgba(255, 255, 255, 0.16)', borderRadius: '6px', cursor: 'pointer' };
const smallButton: React.CSSProperties = { ...button, flex: 'none', height: '24px', padding: '0 8px', fontSize: '11px' };
const pre: React.CSSProperties = { margin: '8px 0 0', padding: '8px', whiteSpace: 'pre-wrap', fontSize: '11px', color: '#d8d8d8', background: '#111214', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px' };
