/**
 * Sorting rules (settings-spec.md §5): add in one row (an address, or @domain for everyone there);
 * a refused rule says why under the field and keeps what you typed; rules can be edited in place,
 * and deleted at once with Undo.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { api, acct, errorText } from '../../api/client';
import type { Account, BucketView, RuleView } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { BucketGlyph } from '../Buckets/BucketGlyph';
import { FieldsSkeleton, LoadFailed, Problem } from './parts';
import { sentence, useSectionData } from './useSettings';

interface RulesData { rules: RuleView[]; buckets: BucketView[] }

export const RulesSection: React.FC<{ account: Account }> = ({ account }) => {
    const { showToast } = useMail();
    const { data, failed, retry, setData, refresh } = useSectionData<RulesData>(async () => {
        const [r, b] = await Promise.all([
            api.get<{ rules: RuleView[] }>(`${acct(account.id)}/rules`),
            api.get<{ buckets: BucketView[] }>(`${acct(account.id)}/buckets`),
        ]);
        return { rules: r.rules, buckets: b.buckets };
    }, account.id);
    // Undo can come after this section has gone (the notice outlives it): it fetches again if it's here
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; });

    if (failed) return <LoadFailed onRetry={retry} />;
    if (!data) return <FieldsSkeleton rows={2} />;

    const remove = async (rule: RuleView) => {
        setData(d => ({ ...d, rules: d.rules.filter(r => r.id !== rule.id) }));
        try {
            await api.del(`${acct(account.id)}/rules/${encodeURIComponent(rule.id)}`);
        } catch (err) {
            showToast({ message: `Couldn't delete the rule: ${errorText(err)}`, tone: 'error' });
            void refresh();
            return;
        }
        showToast({
            message: `Deleted the rule for ${rule.senderPattern}`,
            actions: [{
                label: 'Undo',
                onClick: () => {
                    api.post(`${acct(account.id)}/rules`, { senderPattern: rule.senderPattern, bucket: rule.bucket, createdAt: rule.createdAt })
                        .then(() => refreshRef.current())
                        .catch(err => showToast({ message: `Couldn't put the rule back: ${errorText(err)}`, tone: 'error' }));
                },
            }],
        });
    };

    // Newest first, under the row that adds them
    const rules = [...data.rules].reverse();
    return (
        <>
            <AddRule accountId={account.id} buckets={data.buckets} onAdded={() => void refresh()} />
            {rules.length > 0 && (
                <div className="st-list" role="list" aria-label="Rules">
                    {rules.map(rule => (
                        <RuleRow key={rule.id} accountId={account.id} rule={rule} buckets={data.buckets}
                            onSaved={next => setData(d => ({ ...d, rules: d.rules.map(r => (r.id === next.id ? next : r)) }))}
                            onDelete={() => void remove(rule)} />
                    ))}
                </div>
            )}
        </>
    );
};

const AddRule: React.FC<{ accountId: string; buckets: BucketView[]; onAdded: () => void }> = ({ accountId, buckets, onAdded }) => {
    const [from, setFrom] = useState('');
    const [bucket, setBucket] = useState(buckets[0]?.name ?? '');
    const [problem, setProblem] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const chosen = buckets.some(b => b.name === bucket) ? bucket : buckets[0]?.name ?? '';

    const add = async () => {
        if (adding || !chosen) return;
        if (!from.trim()) { setProblem('Use a full address (news@example.com) or a domain starting with @ (@example.com)'); return; }
        setAdding(true);
        try {
            await api.post(`${acct(accountId)}/rules`, { senderPattern: from, bucket: chosen });
            setFrom('');
            setProblem(null);
            onAdded();
        } catch (err) {
            setProblem(sentence(errorText(err))); // what you typed stays
        } finally {
            setAdding(false);
        }
    };

    return (
        <div>
            <div className="st-add-rule">
                <div>
                    <label className="st-label" htmlFor="st-rule-from">From</label>
                    <input id="st-rule-from" className="st-input" value={from} spellCheck={false} autoComplete="off"
                        placeholder="news@example.com, or @example.com for everyone there"
                        aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'st-rule-problem' : undefined}
                        onChange={e => { setFrom(e.target.value); setProblem(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
                </div>
                <div>
                    <span className="st-label" id="st-rule-bucket-label">Bucket</span>
                    <BucketPicker buckets={buckets} value={chosen} onChange={setBucket} labelledBy="st-rule-bucket-label" />
                </div>
                <div>
                    <span className="st-label" aria-hidden="true">&nbsp;</span>
                    <button type="button" className="st-primary" onClick={() => void add()} disabled={adding || !chosen} style={{ height: 40 }}>Add rule</button>
                </div>
            </div>
            {problem && <Problem id="st-rule-problem">{problem}</Problem>}
            {!buckets.length && <p className="st-hint">Rules file mail into buckets, and this account has none yet</p>}
        </div>
    );
};

const RuleRow: React.FC<{
    accountId: string;
    rule: RuleView;
    buckets: BucketView[];
    onSaved: (rule: RuleView) => void;
    onDelete: () => void;
}> = ({ accountId, rule, buckets, onSaved, onDelete }) => {
    const [editing, setEditing] = useState(false);
    const [from, setFrom] = useState(rule.senderPattern);
    const [bucket, setBucket] = useState(rule.bucket);
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const id = useId();
    const target = buckets.find(b => b.name === rule.bucket);

    const start = () => {
        setFrom(rule.senderPattern);
        setBucket(buckets.some(b => b.name === rule.bucket) ? rule.bucket : buckets[0]?.name ?? rule.bucket);
        setProblem(null);
        setEditing(true);
    };
    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const { rule: next } = await api.patch<{ rule: RuleView }>(`${acct(accountId)}/rules/${encodeURIComponent(rule.id)}`, { senderPattern: from, bucket });
            onSaved(next);
            setEditing(false);
        } catch (err) {
            setProblem(sentence(errorText(err)));
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <div className="st-rule-edit" role="listitem"
                onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setEditing(false); } }}>
                <div className="st-add-rule">
                    <div>
                        <label className="st-label" htmlFor={`${id}-from`}>From</label>
                        <input id={`${id}-from`} className="st-input" value={from} spellCheck={false} autoComplete="off" autoFocus
                            aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-problem` : undefined}
                            onChange={e => { setFrom(e.target.value); setProblem(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
                    </div>
                    <div>
                        <span className="st-label" id={`${id}-bucket`}>Bucket</span>
                        <BucketPicker buckets={buckets} value={bucket} onChange={setBucket} labelledBy={`${id}-bucket`} />
                    </div>
                    <div className="st-row" style={{ alignSelf: 'end', flexWrap: 'nowrap' }}>
                        <button type="button" className="st-btn" style={{ height: 40 }} onClick={() => setEditing(false)}>Cancel</button>
                        <button type="button" className="st-primary" style={{ height: 40 }} onClick={() => void save()} disabled={saving}>Save</button>
                    </div>
                </div>
                {problem && <Problem id={`${id}-problem`}>{problem}</Problem>}
            </div>
        );
    }
    return (
        <div className="st-rule" role="listitem">
            <span className="st-from" title={rule.senderPattern}>{rule.senderPattern}</span>
            <span className="st-to">
                <span aria-hidden="true">→</span>
                {target ? (
                    <>
                        <BucketGlyph stored={target.emoji} label={target.name} size={15} fallbackStyle={{ fontSize: 12, width: 15, textAlign: 'center' }} />
                        <span>{target.name}</span>
                    </>
                ) : <span style={{ color: 'var(--color-text-faint)' }}>a deleted bucket</span>}
            </span>
            <button type="button" className="st-icon" aria-label={`Edit rule for ${rule.senderPattern}`} title="Edit" onClick={start}>
                <Pencil size={15} aria-hidden="true" />
            </button>
            <button type="button" className="st-icon" aria-label={`Delete rule for ${rule.senderPattern}`} title="Delete" onClick={onDelete}>
                <Trash2 size={15} aria-hidden="true" />
            </button>
        </div>
    );
};

/** The buckets, each with its line icon and name (no colour dots), as a list box. */
const BucketPicker: React.FC<{ buckets: BucketView[]; value: string; onChange: (name: string) => void; labelledBy: string }> = ({ buckets, value, onChange, labelledBy }) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const box = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const listId = useId();
    const current = buckets.find(b => b.name === value);

    useEffect(() => {
        if (!open) return;
        const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', away);
        return () => document.removeEventListener('pointerdown', away);
    }, [open]);

    const show = () => {
        setActive(Math.max(0, buckets.findIndex(b => b.name === value)));
        setOpen(true);
    };
    const pick = (i: number) => {
        const b = buckets[i];
        if (b) onChange(b.name);
        setOpen(false);
        button.current?.focus();
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
            return;
        }
        const last = buckets.length - 1;
        if (e.key === 'ArrowDown') setActive(a => Math.min(a + 1, last));
        else if (e.key === 'ArrowUp') setActive(a => Math.max(a - 1, 0));
        else if (e.key === 'Home') setActive(0);
        else if (e.key === 'End') setActive(last);
        else if (e.key === 'Enter' || e.key === ' ') pick(active);
        else if (e.key === 'Escape') setOpen(false); // the list, not Settings
        else if (e.key === 'Tab') { setOpen(false); return; }
        else return;
        e.preventDefault();
    };

    return (
        <div className="st-picker" ref={box}>
            <button ref={button} type="button" className="st-input" disabled={!buckets.length}
                aria-haspopup="listbox" aria-expanded={open} aria-labelledby={labelledBy} aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? `${listId}-${active}` : undefined}
                onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown}>
                {current && <BucketGlyph stored={current.emoji} label={current.name} size={15} fallbackStyle={{ fontSize: 12, width: 15, textAlign: 'center' }} />}
                <span>{current?.name ?? 'No buckets'}</span>
                <ChevronDown size={14} aria-hidden="true" style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
            </button>
            {open && (
                <ul className="st-options" role="listbox" id={listId} aria-labelledby={labelledBy}>
                    {buckets.map((b, i) => (
                        <li key={b.name} id={`${listId}-${i}`} role="option" aria-selected={b.name === value} data-active={i === active}
                            onPointerEnter={() => setActive(i)} onClick={() => pick(i)}>
                            <BucketGlyph stored={b.emoji} label={b.name} size={15} fallbackStyle={{ fontSize: 12, width: 15, textAlign: 'center' }} />
                            {b.name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
