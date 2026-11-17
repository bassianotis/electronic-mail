/**
 * Settings, revised (docs/design/settings-spec.md; canvas "Electronic Mail Screens", page
 * "Settings, revised"): sections down the side, split into this account's (Name and signature,
 * Password and servers, Sorting rules, Opening mail) and General (Accounts, Back up settings), with
 * the account named at the top and switchable there. Esc, the X or a click outside closes it;
 * anything typed but not yet saved is saved first.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Download, ExternalLink, Filter, Key, TriangleAlert, UserRound, Users, X } from 'lucide-react';
import { useMail } from '../../context/MailContext';
import { useStatuses } from '../../api/events';
import { tabLabel } from '../../utils/accountLabel';
import { NameSection } from './NameSection';
import { PasswordSection } from './PasswordSection';
import { RulesSection } from './RulesSection';
import { OpeningSection } from './OpeningSection';
import { AccountsSection } from './AccountsSection';
import { AddAccount } from './AddAccount';
import { BackupSection } from './BackupSection';
import { IconButton } from '../../ui/Button';
import { Back, Dialog } from '../../ui/Dialog';
import { Menu, MenuItem } from '../../ui/Menu';
import { rememberSection, type SectionKey, type SettingsTarget } from './useSettings';
import './settings.css';

const SECTIONS: { key: SectionKey; title: string; icon: React.ElementType; perAccount: boolean }[] = [
    { key: 'name', title: 'Name and signature', icon: UserRound, perAccount: true },
    { key: 'password', title: 'Password and servers', icon: Key, perAccount: true },
    { key: 'rules', title: 'Sorting rules', icon: Filter, perAccount: true },
    { key: 'opening', title: 'Opening mail', icon: ExternalLink, perAccount: true },
    { key: 'accounts', title: 'Accounts', icon: Users, perAccount: false },
    { key: 'backup', title: 'Back up settings', icon: Download, perAccount: false },
];

export const SettingsDialog: React.FC<{ at: SettingsTarget; onClose: () => void }> = ({ at, onClose }) => {
    const { accounts, activeAccountId, fetchAccounts } = useMail();
    const statuses = useStatuses(accounts);
    // The latest of each account's status (when mail was last checked isn't pushed every minute)
    useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);
    const [section, setSection] = useState<SectionKey>(at.section);
    const [pickedAccount, setPickedAccount] = useState<string | null>(at.accountId ?? activeAccountId);
    const [menuOpen, setMenuOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [justAdded, setJustAdded] = useState<string | null>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const switcher = useRef<HTMLButtonElement>(null);
    // Modal (rule L3), from the shared Dialog: the focus starts on the dialog, Tab stays in it, the
    // page behind is inert, and closing goes back to whatever opened it

    // The account it shows: the one picked, else (if that one's gone) the open one
    const account = accounts.find(a => a.id === pickedAccount) ?? accounts.find(a => a.id === activeAccountId) ?? accounts[0] ?? null;
    const rejected = (id: string) => statuses.get(id)?.state === 'auth-failed';
    const anyRejected = accounts.some(a => rejected(a.id));
    const current = SECTIONS.find(s => s.key === section)!;

    // Closing leaves the field you're in first, so what you typed there is saved (Esc used to drop it)
    const close = () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        onClose();
    };
    // Esc closes it (rule L4; the account menu handles its own Esc first), and so does a click
    // outside: everything here saves as you go, so nothing typed is lost

    // Notices ("Deleted the rule for … · Undo") sit just above the dialog's bottom edge while it's
    // open, not half over it (owner, 2026-11-11). Its place in the layout, not its opening scale.
    useLayoutEffect(() => {
        const el = dialog.current;
        if (!el) return;
        const root = document.documentElement;
        const place = () => root.style.setProperty('--notice-bottom', `${Math.max(16, window.innerHeight - (el.offsetTop + el.offsetHeight) + 16)}px`);
        place();
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('resize', place);
            root.style.removeProperty('--notice-bottom');
        };
    }, []);

    const go = (key: SectionKey) => {
        setSection(key);
        rememberSection(key);
        setAdding(false);
        setJustAdded(null);
        setMenuOpen(false);
    };

    const title = adding && section === 'accounts' ? 'Add an email account' : current.title;
    const scope = current.perAccount && account ? `For ${tabLabel(account, accounts)} · ${account.email}` : 'For every account';

    let body: React.ReactNode = null;
    if (section === 'accounts') {
        body = adding
            ? <AddAccount onDone={email => { setAdding(false); setJustAdded(email); }} onCancel={() => setAdding(false)} />
            : <AccountsSection statuses={statuses} justAdded={justAdded} onAdd={() => { setAdding(true); setJustAdded(null); }} />;
    } else if (section === 'backup') {
        body = <BackupSection />;
    } else if (account) {
        const status = statuses.get(account.id)!;
        body = section === 'name' ? <NameSection key={account.id} account={account} />
            : section === 'password' ? <PasswordSection key={account.id} account={account} status={status} />
            : section === 'rules' ? <RulesSection key={account.id} account={account} />
            : <OpeningSection key={account.id} account={account} />;
    }

    return (
        <Dialog ref={dialog} bare title="Settings" titleId="st-title" onClose={close} className="st-dialog">
                <nav className="st-side" aria-label="Settings sections">
                    <h2>Settings</h2>
                    <div className="st-group">Account</div>
                    {account && (
                        <AccountSwitcher
                            buttonRef={switcher}
                            open={menuOpen}
                            onOpen={setMenuOpen}
                            current={account}
                            label={a => tabLabel(a, accounts)}
                            rejected={rejected}
                            onPick={id => { setPickedAccount(id); setMenuOpen(false); switcher.current?.focus(); }}
                        />
                    )}
                    {SECTIONS.filter(s => s.perAccount).map(s => (
                        <NavItem key={s.key} section={s} current={section === s.key} onClick={() => go(s.key)}
                            warn={s.key === 'password' && !!account && rejected(account.id)} />
                    ))}
                    <div className="st-group">General</div>
                    {SECTIONS.filter(s => !s.perAccount).map(s => (
                        <NavItem key={s.key} section={s} current={section === s.key} onClick={() => go(s.key)}
                            warn={s.key === 'accounts' && anyRejected} />
                    ))}
                </nav>
                <section className="st-main" aria-labelledby="st-title">
                    <div className="st-head">
                        <div>
                            {adding && section === 'accounts' && <Back to="Accounts" onClick={() => setAdding(false)} />}
                            <h3 id="st-title">{title}</h3>
                            {!(adding && section === 'accounts') && <p className="st-scope">{scope}</p>}
                        </div>
                        <IconButton label="Close settings" className="st-close" onClick={close} icon={<X size={16} aria-hidden="true" />} />
                    </div>
                    <div className="st-body" key={`${section}-${adding ? 'adding' : ''}-${current.perAccount ? account?.id : ''}`}>
                        {body}
                    </div>
                </section>
        </Dialog>
    );
};

const NavItem: React.FC<{ section: (typeof SECTIONS)[number]; current: boolean; warn: boolean; onClick: () => void }> = ({ section, current, warn, onClick }) => {
    const Icon = section.icon;
    return (
        <button type="button" className="st-nav-item" aria-current={current ? 'page' : undefined} onClick={onClick}>
            <Icon size={16} aria-hidden="true" />
            {section.title}
            {warn && <span className="st-warn" title="Password rejected"><TriangleAlert size={13} aria-label="Password rejected" /></span>}
        </button>
    );
};

/** The account Settings is showing, and a menu of the others (a warning beside any refused one). */
const AccountSwitcher: React.FC<{
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onOpen: (open: boolean) => void;
    current: { id: string; email: string; tabName: string | null };
    label: (a: { email: string; tabName: string | null }) => string;
    rejected: (id: string) => boolean;
    onPick: (id: string) => void;
}> = ({ buttonRef, open, onOpen, current, label, rejected, onPick }) => {
    const { accounts } = useMail();

    return (
        <div style={{ position: 'relative' }}>
            <button ref={buttonRef} type="button" className="st-switcher" aria-haspopup="menu" aria-expanded={open}
                aria-label={`Account: ${label(current)}, ${current.email}. Switch account`}
                onClick={() => onOpen(!open)}>
                <span className="st-who">
                    <b>{label(current)}</b>
                    <small>{current.email}</small>
                </span>
                <span className="st-chevrons"><ChevronsUpDown size={14} aria-hidden="true" /></span>
            </button>
            {open && (
                // The shared Menu: the checked account takes the focus; arrows, Esc (the menu, not Settings), Tab
                <Menu label="Accounts" className="st-menu" style={{ left: 0, right: 0, top: 'calc(100% - 2px)' }}
                    anchor={buttonRef} onClose={() => onOpen(false)} returnFocus={() => buttonRef.current}>
                    {accounts.map(a => (
                        <MenuItem key={a.id} checked={a.id === current.id} onSelect={() => onPick(a.id)}>
                            <span className="st-who">
                                <b>{label(a)}</b>
                                <small>{a.email}</small>
                            </span>
                            {rejected(a.id) && <span className="st-warn"><TriangleAlert size={13} aria-label="Password rejected" /></span>}
                        </MenuItem>
                    ))}
                </Menu>
            )}
        </div>
    );
};
