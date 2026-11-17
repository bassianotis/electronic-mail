/**
 * Back up settings (settings-spec.md §8): plain words for what were Export and Import. Restoring
 * shows what it did in place, not in a browser alert, with Reload now.
 */
import React, { useRef, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { api, ApiError, couldnt, urls } from '../../api/client';
import type { ImportSummary } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Note';
import { Problem } from './parts';

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
            // The engine's own words say which
            const notOurs = err instanceof ApiError && /not an Electronic Mail settings file/i.test(err.message);
            setProblem(notOurs ? NOT_A_FILE : couldnt('restore it', err));
        } finally {
            setRestoring(false);
        }
    };

    return (
        <>
            <div className="st-section">
                <h4>Save a copy</h4>
                <p>Names, tab names, signatures, sorting rules, how buckets look and the Inbox setting, for every account. No mail and no passwords.</p>
                <Button icon={<Download size={16} aria-hidden="true" />} onClick={() => download(urls.exportSettings, 'electronic-mail-settings.json')}>Download settings file</Button>
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
                <Button onClick={() => picker.current?.click()} working={restoring && 'Restoring…'}>Choose a file…</Button>
                {problem && <Problem>{problem}</Problem>}
                {result && (
                    <Note role="status" style={{ marginTop: 'var(--space-3)' }} icon={<Check size={16} aria-hidden="true" className="is-good" />}
                        action={<Button kind="quiet" size="sm" onClick={() => window.location.reload()}>Reload now</Button>}>
                        {restoredText(result)}
                    </Note>
                )}
            </div>
        </>
    );
};
