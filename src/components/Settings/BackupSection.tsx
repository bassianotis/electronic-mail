/**
 * Back up settings (settings-spec.md §8): plain words for what were Export and Import. Restoring
 * shows what it did in place, not in a browser alert, with Reload now.
 */
import React, { useRef, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { api, errorText, urls } from '../../api/client';
import type { ImportSummary } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Problem } from './parts';
import { sentence } from './useSettings';

const NOT_A_FILE = "This isn't a Mail settings file";
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Restored for 2 accounts: 9 bucket looks, 4 new rules. Skipped old@example.test (not set up here)" */
function restoredText(s: ImportSummary): string {
    const what = `Restored for ${count(s.updatedAccounts.length, 'account')}: ${count(s.buckets, 'bucket look')}, ${count(s.rules, 'new rule')}`;
    const skipped = s.skippedAccounts.length ? `. Skipped ${s.skippedAccounts.join(', ')} (not set up here)` : '';
    const problems = s.problems.length ? `. Not restored: ${s.problems.join('; ')}` : '';
    return what + skipped + problems;
}

export const BackupSection: React.FC = () => {
    const { download } = useMail();
    const picker = useRef<HTMLInputElement>(null);
    const [result, setResult] = useState<ImportSummary | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(false);

    const restore = async (file: File) => {
        setProblem(null);
        setResult(null);
        let content: unknown;
        try {
            content = JSON.parse(await file.text());
        } catch {
            setProblem(NOT_A_FILE);
            return;
        }
        setRestoring(true);
        try {
            const { summary } = await api.post<{ summary: ImportSummary }>('/settings/import', content);
            setResult(summary);
        } catch (err) {
            const text = errorText(err);
            setProblem(/not an Electronic Mail settings file/i.test(text) ? NOT_A_FILE : `Couldn't restore it: ${sentence(text)}`);
        } finally {
            setRestoring(false);
        }
    };

    return (
        <>
            <div className="st-section">
                <h4>Save a copy</h4>
                <p>Names, tab names, signatures, sorting rules, how buckets look and the Inbox setting, for every account. No mail and no passwords.</p>
                <button type="button" className="st-btn" onClick={() => download(urls.exportSettings, 'electronic-mail-settings.json')}>
                    <Download size={16} aria-hidden="true" />Download settings file
                </button>
            </div>
            <div className="st-section">
                <h4>Restore from a file</h4>
                <p>Adds the rules and bucket looks from a settings file to the accounts here, matched by address. Nothing is removed.</p>
                <input ref={picker} type="file" accept=".json,application/json" hidden
                    onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = ''; // the same file can be chosen again
                        if (file) void restore(file);
                    }} />
                <button type="button" className="st-btn" onClick={() => picker.current?.click()} disabled={restoring}>
                    {restoring ? 'Restoring…' : 'Choose a file…'}
                </button>
                {problem && <Problem>{problem}</Problem>}
                {result && (
                    <div className="st-box" role="status" style={{ marginTop: 12 }}>
                        <span className="st-good"><Check size={16} aria-hidden="true" /></span>
                        <span style={{ flex: 1 }}>{restoredText(result)}</span>
                        <button type="button" className="st-text" style={{ flexShrink: 0 }} onClick={() => window.location.reload()}>Reload now</button>
                    </div>
                )}
            </div>
        </>
    );
};
