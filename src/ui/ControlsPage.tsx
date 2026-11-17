/**
 * The shared controls, every one in every state, with made-up content only (design system v2,
 * phase 2a). Development only: main.tsx loads it for `?controls` when import.meta.env.DEV, so it
 * never reaches the production bundle, and it never talks to the engine.
 * Hover, pressed and focus are shown live: point at them, press, Tab. The phase's check forces them
 * for its screenshots (data-state="hover" / "active" / "focus").
 */
import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Archive, ChevronDown, ChevronUp, Forward, SquarePen, Reply, ReplyAll, Send, Trash2, WifiOff, X } from 'lucide-react';
import { Button, ButtonPair, IconButton } from './Button';
import { Field, PasswordInput, Select, TextArea, TextInput } from './Field';
import { Checkbox, RadioGroup, Segmented, Switch } from './Choice';
import { Back, Dialog, Question } from './Dialog';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { Tooltip } from './Tooltip';
import { Notice } from './Notice';
import { Note } from './Note';
import { Band } from './Band';
import './controls-page.css';

// D5: long and odd content is expected
const LONG = 'Minutes from the co-op’s autumn meeting: the roof repair schedule, the new compost rota, who has the spare keys to the tool shed, the bulk order of oats and lentils, and the vote on whether the Thursday pick-up moves to Wednesday evenings from the first week of December onwards (please read before Sunday)';
const ARABIC = 'اجتماع اللجنة يوم الخميس';
const NAME_JA = '山田 花子';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="cp-section" aria-labelledby={`cp-${title}`}>
        <h2 id={`cp-${title}`}>{title}</h2>
        {children}
    </section>
);
const Cell: React.FC<{ caption: string; children: React.ReactNode }> = ({ caption, children }) => (
    <div className="cp-cell"><div className="cp-cell__body">{children}</div><span className="cp-caption">{caption}</span></div>
);

const STATES = [['rest', undefined], ['hover', 'hover'], ['pressed', 'active'], ['focus', 'focus']] as const;

const ControlsPage: React.FC = () => {
    const [name, setName] = useState('Theo Marsh');
    const [email, setEmail] = useState('theo@lakeside');
    const [opening, setOpening] = useState<'reader' | 'place' | 'reader-on'>('reader');
    const [size, setSize] = useState<'s' | 'm' | 'l' | 'xl'>('m');
    const [view, setView] = useState<'reading' | 'place'>('reading');
    const [images, setImages] = useState(true);
    const [archive, setArchive] = useState(false);
    const [count, setCount] = useState(false);
    const [checks, setChecks] = useState({ home: true, badge: false });
    const [dialog, setDialog] = useState<null | 'bucket' | 'step'>(null);
    const [bucketName, setBucketName] = useState('');
    const [asking, setAsking] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [menu, setMenu] = useState(false);
    const [notice, setNotice] = useState<null | { id: number; message: React.ReactNode; tone?: 'error'; action?: boolean }>(null);
    const menuButton = React.useRef<HTMLButtonElement>(null);
    const say = (n: Omit<NonNullable<typeof notice>, 'id'>) => setNotice({ ...n, id: Date.now() });

    return (
        <main className="cp-page">
            <header className="cp-head">
                <p className="cp-kicker">Design system v2 · phase 2a · made-up content</p>
                <h1>The shared controls</h1>
            </header>

            <Section title="Button">
                <div className="cp-grid cp-grid--states">
                    <span />{['Rest', 'Hover', 'Pressed', 'Focus', 'Disabled', 'Working'].map(h => <span key={h} className="cp-caption">{h}</span>)}
                    {([['primary', 'Send', 'Sending…'], ['secondary', 'Cancel', null], ['quiet', 'Details', null], ['danger', 'Remove', 'Removing…']] as const).map(([kind, label, word]) => (
                        <React.Fragment key={kind}>
                            <span className="cp-row-head">{kind}</span>
                            {STATES.map(([state, force]) => <span key={state}><Button kind={kind} data-state={force}>{label}</Button></span>)}
                            <span><Button kind={kind} disabled>{label}</Button></span>
                            <span>{word ? <Button kind={kind} working={word}>{label}</Button> : <span className="cp-caption">n/a</span>}</span>
                        </React.Fragment>
                    ))}
                </div>
                <div className="cp-row">
                    <Cell caption="small 28 · 13px: notices, the band"><Button size="sm">Undo</Button></Cell>
                    <Cell caption="medium 36 · 14px: the default"><Button icon={<SquarePen size={16} aria-hidden="true" />}>Compose</Button></Cell>
                    <Cell caption="large 40: Send, the reading bar"><Button kind="primary" size="lg" trailingIcon={<Send size={16} aria-hidden="true" />}>Send</Button></Cell>
                    <Cell caption="48 · 16px: sign-in only"><Button kind="primary" size="xl">Sign in</Button></Cell>
                    <Cell caption="A6: press it (the word, then done)"><Button kind="primary" progress="Checking with the server…" onClick={() => wait(1500)}>Check and save</Button></Cell>
                </div>
                <div className="cp-row">
                    <Cell caption="28 × 28"><IconButton size={28} label="Close" icon={<X size={16} aria-hidden="true" />} /></Cell>
                    <Cell caption="32 × 32 (a dialog's close)"><IconButton label="Close settings" keys="Esc" icon={<X size={16} aria-hidden="true" />} /></Cell>
                    <Cell caption="36, with an edge"><IconButton size={36} kind="secondary" label="Older message" keys="↑" icon={<ChevronUp size={16} aria-hidden="true" />} /></Cell>
                    <Cell caption="a pair: one group, two buttons">
                        <ButtonPair label="Messages">
                            <IconButton size={36} label="Older message" keys="↑" icon={<ChevronUp size={16} aria-hidden="true" />} />
                            <IconButton size={36} label="Newer message" keys="↓" icon={<ChevronDown size={16} aria-hidden="true" />} />
                        </ButtonPair>
                    </Cell>
                    <Cell caption="quiet, red words (opens a question)"><Button kind="quiet" size="sm" dangerText>Remove…</Button></Cell>
                </div>
            </Section>

            <Section title="Field">
                <div className="cp-grid cp-grid--3">
                    <Field label="Your name" htmlFor="cp-f1" hint="empty, placeholder in text-4"><TextInput id="cp-f1" placeholder="Theo Marsh" /></Field>
                    <Field label="Your name" htmlFor="cp-f2" hint="filled"><TextInput id="cp-f2" value={name} onChange={e => setName(e.target.value)} /></Field>
                    <Field label="Your name" htmlFor="cp-f3" hint="hover: edge 28%"><TextInput id="cp-f3" defaultValue="Theo Marsh" data-state="hover" /></Field>
                    <Field label="Your name" htmlFor="cp-f4" hint="focus: the ring"><TextInput id="cp-f4" defaultValue="Theo Marsh" data-state="focus" /></Field>
                    <Field label="Your name" htmlFor="cp-f5" hint="read-only: no edge"><TextInput id="cp-f5" defaultValue="Theo Marsh" readOnly /></Field>
                    <Field label="Your name" htmlFor="cp-f6" hint="disabled: 40%"><TextInput id="cp-f6" defaultValue="Theo Marsh" disabled /></Field>
                    <Field label="Email address" htmlFor="cp-f7" hint="The whole address, as you'd write it" hintId="cp-f7-hint">
                        <TextInput id="cp-f7" type="email" defaultValue="theo@lakeside-coop.example" aria-describedby="cp-f7-hint" />
                    </Field>
                    <Field label="Email address" htmlFor="cp-f8" problem="That doesn't look like a whole address" problemId="cp-f8-problem">
                        <TextInput id="cp-f8" type="email" value={email} onChange={e => setEmail(e.target.value)} invalid aria-describedby="cp-f8-problem" />
                    </Field>
                    <Field label="Password" htmlFor="cp-f9" hint="password: Show / Hide, a 24px target inside"><PasswordInput id="cp-f9" defaultValue="made-up-pass" /></Field>
                    <Field label="Security" htmlFor="cp-f10" hint="select">
                        <Select id="cp-f10" defaultValue="ssl"><option value="ssl">SSL/TLS (usually 993)</option><option value="starttls">STARTTLS (usually 143)</option></Select>
                    </Field>
                    <Field label="Receiving server" htmlFor="cp-f11" hint="something you type exactly: mono"><TextInput id="cp-f11" mono defaultValue="imap.lakeside-coop.example" /></Field>
                    <Field label="Signature" optional htmlFor="cp-f12" hint="text area, optional marked"><TextArea id="cp-f12" rows={3} defaultValue={'Theo · Lakeside Co-op, plot 7'} /></Field>
                    <Field label="Subject" htmlFor="cp-f13" hint="D5: a long subject"><TextInput id="cp-f13" defaultValue={LONG} /></Field>
                    <Field label="Subject" htmlFor="cp-f14" hint="D5: another script" aside="Saved"><TextInput id="cp-f14" dir="auto" defaultValue={ARABIC} /></Field>
                    <Field label="Message" htmlFor="cp-f15" hint="D5: an empty body"><TextArea id="cp-f15" rows={3} placeholder="Write a reply" /></Field>
                </div>
            </Section>

            <Section title="Checkbox, radio, switch, segmented">
                <div className="cp-grid cp-grid--3">
                    <Checkbox label="Show on home" checked={false} onChange={() => {}} hint="off" />
                    <Checkbox label="Show on home" checked onChange={() => {}} hint="on" />
                    <div data-state-within="hover"><Checkbox label="Show on home" checked={false} onChange={() => {}} hint="hover: edge 28%" /></div>
                    <Checkbox label="Show on home" checked onChange={() => {}} hint="focus" data-state="focus" />
                    <Checkbox label="Show on home" indeterminate checked={false} onChange={() => {}} hint="some (a group)" />
                    <Checkbox label="Show on home" checked disabled onChange={() => {}} hint="disabled" />
                    <Checkbox label="Show thread count badge" checked={checks.badge} onChange={e => setChecks(c => ({ ...c, badge: e.target.checked }))} hint="live: Space toggles" />
                    <Checkbox label={NAME_JA} checked={checks.home} onChange={e => setChecks(c => ({ ...c, home: e.target.checked }))} hint="D5: another script" />
                </div>
                <div className="cp-row">
                    <Cell caption="radio: one Tab stop; arrows choose">
                        <RadioGroup name="cp-opening" label="Opening" value={opening} onChange={setOpening} options={[
                            { value: 'reader', label: 'Open in the reading view' },
                            { value: 'place', label: 'Open in place, in the list' },
                            { value: 'reader-on', label: 'Open in the reading view, Reader on', hint: 'with a hint under it' },
                        ]} />
                    </Cell>
                    <Cell caption="switch: takes effect at once (role switch)">
                        <div className="cp-stack">
                            <Switch label="Load images from this sender" checked={images} onChange={setImages} />
                            <Switch label="Auto-archive after 30 days" checked={archive} onChange={setArchive} />
                            <span data-state-within="focus-button"><Switch label="Show the count on the dock" checked={count} onChange={setCount} /></span>
                            <Switch label="Off and disabled" checked={false} onChange={() => {}} disabled />
                        </div>
                    </Cell>
                    <Cell caption="segmented: one Tab stop; arrows move">
                        <div className="cp-stack">
                            <Segmented label="Open in" value={view} onChange={setView} options={[{ value: 'reading', label: 'Reading view' }, { value: 'place', label: 'In place' }]} />
                            <Segmented label="Text size" value={size} onChange={setSize} options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }, { value: 'xl', label: 'Extra large' }]} />
                        </div>
                    </Cell>
                </div>
            </Section>

            <Section title="Dialog, steps and questions">
                <div className="cp-row">
                    <Cell caption="a dialog: title, close, content, actions on the right"><Button onClick={() => { setBucketName(''); setDialog('bucket'); }}>Open “New bucket”</Button></Cell>
                    <Cell caption="a second step inside it, with Back"><Button onClick={() => setDialog('step')}>Open a dialog with a step</Button></Cell>
                </div>
                <div className="cp-question">
                    {asking ? (
                        <Question title="Remove theo@lakeside-coop.example from Mail?" onCancel={() => setAsking(false)} busy={removing}
                            action={<Button kind="danger" working={removing && 'Removing…'} onClick={async () => { setRemoving(true); await wait(1500); setRemoving(false); setAsking(false); }}>Remove account</Button>}>
                            Its mail stays on the mail server. Its rules and sending settings here go.
                        </Question>
                    ) : <Button kind="quiet" size="sm" dangerText onClick={() => setAsking(true)}>Remove…</Button>}
                    <Question focusCancel={false} title={`Delete the rule for “${LONG}”?`} onCancel={() => {}} action={<Button kind="danger">Delete rule</Button>}>
                        D5: a long subject in a question. The rule stops filing new mail; what it filed stays.
                    </Question>
                </div>
                <AnimatePresence>
                    {dialog === 'bucket' && (
                        <Dialog key="cp-bucket" title="New bucket" onClose={() => setDialog(null)} dirty={!!bucketName}
                            onSubmit={e => { e.preventDefault(); setDialog(null); }}
                            actions={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button kind="primary" type="submit" disabled={!bucketName.trim()}>Create bucket</Button></>}>
                            <Field label="Name" htmlFor="cp-bucket-name" hint="Type, then click outside: it stays open">
                                <TextInput id="cp-bucket-name" value={bucketName} onChange={e => setBucketName(e.target.value)} placeholder="Co-op" />
                            </Field>
                            <Checkbox label="Show on home" checked={checks.home} onChange={e => setChecks(c => ({ ...c, home: e.target.checked }))} />
                        </Dialog>
                    )}
                    {dialog === 'step' && (
                        <Dialog key="cp-step" title="Settings" width={440} onClose={() => setDialog(null)}
                            actions={<Button kind="primary" progress="Checking with the server…" onClick={() => wait(1500)}>Check and add</Button>}>
                            <div><Back to="Accounts" onClick={() => setDialog(null)} /><h3 className="cp-step-title">Add an email account</h3></div>
                            <Field label="Email address" htmlFor="cp-step-email"><TextInput id="cp-step-email" type="email" defaultValue="theo@lakeside-coop.example" /></Field>
                            <Field label="Password" htmlFor="cp-step-pass"><PasswordInput id="cp-step-pass" defaultValue="made-up-pass" wrapStyle={{ maxWidth: 'none' }} /></Field>
                        </Dialog>
                    )}
                </AnimatePresence>
            </Section>

            <Section title="Menu and tooltip">
                <div className="cp-row cp-row--top">
                    <Cell caption="a menu: items 32, an icon, a separator, a destructive item last (as drawn)">
                        <div className="ba-menu cp-static-menu" aria-hidden="true">
                            <span className="ba-menu__item"><span className="ba-menu__icon"><Reply size={16} /></span><span className="ba-menu__label">Reply</span></span>
                            <span className="ba-menu__item" data-state="hover"><span className="ba-menu__icon"><ReplyAll size={16} /></span><span className="ba-menu__label">Reply all</span></span>
                            <span className="ba-menu__item"><span className="ba-menu__icon"><Forward size={16} /></span><span className="ba-menu__label">Forward</span></span>
                            <span className="ba-menu__sep" />
                            <span className="ba-menu__item cp-ring"><span className="ba-menu__icon"><Archive size={16} /></span><span className="ba-menu__label">Move to Archive</span></span>
                            <span className="ba-menu__item ba-menu__item--danger"><span className="ba-menu__icon"><Trash2 size={16} /></span><span className="ba-menu__label">Discard draft</span></span>
                        </div>
                    </Cell>
                    <Cell caption="live: Enter, Space or ↓ opens; arrows; Esc">
                        <div style={{ position: 'relative' }}>
                            <Button ref={menuButton} aria-haspopup="menu" aria-expanded={menu} trailingIcon={<ChevronDown size={16} aria-hidden="true" />}
                                onClick={() => setMenu(o => !o)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(true); } }}>
                                Send from
                            </Button>
                            {menu && (
                                <Menu label="Send from" anchor={menuButton} onClose={() => setMenu(false)} returnFocus={() => menuButton.current}
                                    style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 260, zIndex: 1 }}>
                                    <MenuItem checked onSelect={() => setMenu(false)}>Co-op <span className="ba-quiet">theo@lakeside-coop.example</span></MenuItem>
                                    <MenuItem checked={false} onSelect={() => setMenu(false)}>Personal <span className="ba-quiet">theo.marsh@example.org</span></MenuItem>
                                    <MenuItem checked={false} onSelect={() => setMenu(false)}>{NAME_JA} <span className="ba-quiet">hanako@example.test</span></MenuItem>
                                    <MenuItem checked={false} disabled title="Sending isn't set up for this account" onSelect={() => {}}>Work <span className="ba-quiet">theo@work.example</span></MenuItem>
                                    <MenuSeparator />
                                    <MenuItem danger icon={<Trash2 size={16} aria-hidden="true" />} onSelect={() => setMenu(false)}>Discard draft</MenuItem>
                                </Menu>
                            )}
                        </div>
                    </Cell>
                    <Cell caption="tooltip: after 500ms or on focus; words and its key only">
                        <div className="cp-stack">
                            <span className="ba-tooltip cp-static-tip"><span className="ba-tooltip__words">Older message</span><kbd>↑</kbd></span>
                            <span className="ba-tooltip cp-static-tip"><span className="ba-tooltip__words"><span className="ba-tooltip__lead">Next</span>{LONG}</span></span>
                            <Tooltip content={<><span className="ba-tooltip__lead">Previous</span><bdi>{ARABIC}</bdi></>}><Button size="sm">Hover me</Button></Tooltip>
                        </div>
                    </Cell>
                </div>
            </Section>

            <Section title="Notice, note, band">
                <div className="cp-stack cp-stack--wide">
                    <Notice message={<>Archived “Pick up the co-op keys”</>} actions={[{ label: 'Undo', onClick: () => {} }]} onTimeout={() => {}} onClose={() => {}} />
                    <span className="cp-caption">with an action: 8s (these previews stay; the buttons below show live ones)</span>
                    <Notice tone="error" message="Couldn’t move it: the server said no. It’s back where it was." onTimeout={() => {}} onClose={() => {}} />
                    <span className="cp-caption">a failure: what happened and what state things are in</span>
                    <Notice message={<>Archived “{LONG}”</>} actions={[{ label: 'Undo', onClick: () => {} }]} onTimeout={() => {}} onClose={() => {}} />
                    <span className="cp-caption">D5: a long subject</span>
                    <Notice message="Archived “No subject”" actions={[{ label: 'Undo', onClick: () => {} }]} onTimeout={() => {}} onClose={() => {}} />
                    <span className="cp-caption">D5: no subject</span>
                    <div className="cp-row">
                        <Button size="sm" onClick={() => say({ message: <>Archived “<bdi>{ARABIC}</bdi>”</>, action: true })}>Show a notice with Undo (8s)</Button>
                        <Button size="sm" onClick={() => say({ message: 'Filed to Reads' })}>Show one without (4s)</Button>
                        <Button size="sm" onClick={() => say({ message: 'Couldn’t create the bucket. Nothing was changed.', tone: 'error' })}>Show a failure (4s)</Button>
                    </div>
                    <Note>Rules run on new mail as it arrives. Mail already here stays where it is.</Note>
                    <Note tone="warning">The sending server isn&apos;t set up, so messages from this account can&apos;t be sent yet.</Note>
                    <Note tone="problem" action={<Button>Try again</Button>}>The mail server rejected this password. Nothing was changed.</Note>
                    <Band icon={<WifiOff size={16} aria-hidden="true" />} what="Can't reach the server" state="Showing what's already open. Trying again in 0:12"
                        action={<Button size="sm">Try now</Button>} />
                </div>
            </Section>

            <div data-layer="notice" className="ba-notices" role="status" aria-live="polite" style={{ bottom: 24 }}>
                <AnimatePresence mode="wait">
                    {notice && (
                        <Notice key={notice.id} message={notice.message} tone={notice.tone}
                            actions={notice.action ? [{ label: 'Undo', onClick: () => {} }] : undefined}
                            onTimeout={() => setNotice(null)} onClose={() => setNotice(null)} />
                    )}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default ControlsPage;
