/**
 * Design trials (?trials): a small panel at the bottom left for trying the design system v2 font
 * candidates while using the app. The owner's tool, not a setting: it opens with ?trials in the
 * address and stays open across reloads until closed; what's chosen is remembered in this browser
 * (and keeps applying with the panel closed) until "Reset to System". Signed-in only (App.tsx).
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { readTrials, setLetterFont, writeTrials, type LetterChoice, type TrialChoices, type TrialFont } from './trialsState';
import { FACES, FRAME_STACK, SYSTEM_STACK, loadFace } from './trialFonts';
import './trials.css';

const FONT_CHOICES: [TrialFont, string][] = [['system', 'System'], ...(Object.entries(FACES) as [TrialFont, { label: string }][]).map(([k, f]) => [k, f.label] as [TrialFont, string])];
const LETTER_CHOICES: [LetterChoice, string][] = [['interface', 'Same as the interface'], ['system', 'System font']];

export default function DesignTrials() {
    const [choices, setChoices] = useState<TrialChoices>(() => {
        const saved = readTrials();
        // ?trials opens it, and it stays open across reloads until it's closed
        const open = saved.open || new URLSearchParams(window.location.search).has('trials');
        if (open !== saved.open) writeTrials({ ...saved, open });
        return { ...saved, open };
    });
    const [problem, setProblem] = useState<string | null>(null);

    const change = (next: Partial<TrialChoices>) => setChoices(prev => {
        const merged = { ...prev, ...next };
        writeTrials(merged);
        return merged;
    });

    // The interface font (the --font-ui token) and the letter font (the mail frame). While a trial
    // font is on, bold is never faked: a weight it doesn't have gets its 500 (trialFonts.ts)
    useEffect(() => {
        const root = document.documentElement;
        if (choices.font === 'system') {
            root.style.removeProperty('--font-ui');
            root.style.removeProperty('font-synthesis-weight');
            setLetterFont(null);
            return;
        }
        let alive = true;
        loadFace(choices.font).then(face => {
            if (!alive) return;
            setProblem(null);
            root.style.setProperty('--font-ui', `"${face.family}", ${SYSTEM_STACK}`);
            root.style.setProperty('font-synthesis-weight', 'none');
            setLetterFont(choices.letter === 'interface' ? { family: `"${face.family}", ${FRAME_STACK}`, faces: face.css } : null);
        }, () => { if (alive) setProblem("Couldn't load that font"); });
        return () => { alive = false; };
    }, [choices.font, choices.letter]);

    if (!choices.open) return null;
    return (
        <aside className="dt-panel" data-layer="panel" aria-label="Design trials"
            onKeyDown={e => {
                // Esc closes the panel only (not the conversation or anything under it)
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); change({ open: false }); }
            }}>
            <div className="dt-head">
                <h2>Design trials</h2>
                <button type="button" className="dt-close" aria-label="Close design trials" onClick={() => change({ open: false })}>
                    <X size={14} aria-hidden="true" />
                </button>
            </div>
            <fieldset>
                <legend>Interface font</legend>
                {FONT_CHOICES.map(([value, label]) => (
                    <label key={value} className="dt-option">
                        <input type="radio" name="dt-font" value={value} checked={choices.font === value} onChange={() => change({ font: value })} />
                        {label}
                    </label>
                ))}
            </fieldset>
            <fieldset>
                <legend>Letter text</legend>
                {LETTER_CHOICES.map(([value, label]) => (
                    <label key={value} className="dt-option">
                        <input type="radio" name="dt-letter" value={value} checked={choices.letter === value} onChange={() => change({ letter: value })} />
                        {label}
                    </label>
                ))}
            </fieldset>
            {problem && <p className="dt-problem" role="alert">{problem}</p>}
            <button type="button" className="dt-reset" onClick={() => change({ font: 'system', letter: 'interface' })}
                disabled={choices.font === 'system' && choices.letter === 'interface'}>
                Reset to System
            </button>
        </aside>
    );
}
