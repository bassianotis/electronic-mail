/**
 * The account rail (Explore 1, board X1BinderA): one tab per account down the window's left edge,
 * like binder tabs; the open account's tab joins the page. Switching swaps everything on screen,
 * so the tabs use manual activation: Up/Down (and Home/End) move focus, Enter or Space switches.
 * With one account the rail still shows, so nothing moves when a second is added.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useMail } from '../../context/MailContext';
import { useComposer } from '../../context/ComposerContext';
import { api } from '../../api/client';
import { signInAgain, useFamily } from '../../api/family';
import { AppsMenu } from '../../shared/AppsMenu';

export const RAIL_WIDTH = 48;
/** How long the tabs take to move (the transitions on .account-tab in index.css). */
const TAB_MS = 150;

const localPart = (email: string) => email.split('@')[0].toLowerCase();

export const AccountRail: React.FC = () => {
    const { accounts, activeAccountId, setActiveAccountId } = useMail();
    const { draft, update: updateDraft } = useComposer();
    // The shared Bassapps sign-in: the apps tile at the top (the tabs stay where they are)
    const family = useFamily();
    const tabs = useRef<(HTMLButtonElement | null)[]>([]);
    const reduced = useReducedMotion();
    // The tab picked, while the tabs move and before the screen swaps to its account
    const [pending, setPending] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const openId = pending ?? activeAccountId;

    // The tabs move first and the screen swaps once they have: swapping a whole account keeps the
    // browser busy for a moment, which made the tabs jump instead of move.
    const open = (id: string) => {
        if (id === openId) return;
        // A docked draft moves to the corner first (it keeps its own accounts), so the switch
        // doesn't take it away with the conversation.
        if (draft?.place === 'docked') updateDraft({ place: 'corner' }, false);
        if (timer.current) clearTimeout(timer.current);
        setPending(id);
        timer.current = setTimeout(() => {
            timer.current = null;
            setActiveAccountId(id);
            setPending(null);
        }, reduced ? 0 : TAB_MS);
    };

    // The tab name set in Settings; else the part before the @, unless two such accounts share it:
    // then the whole address for those two.
    const labelOf = (account: { email: string; tabName: string | null }) => {
        if (account.tabName) return account.tabName;
        const shared = accounts.filter(a => !a.tabName && localPart(a.email) === localPart(account.email)).length > 1;
        return shared ? account.email : account.email.split('@')[0];
    };

    const moveFocus = (e: React.KeyboardEvent, from: number) => {
        const last = accounts.length - 1;
        const to = e.key === 'ArrowDown' ? (from === last ? 0 : from + 1)
            : e.key === 'ArrowUp' ? (from === 0 ? last : from - 1)
            : e.key === 'Home' ? 0
            : e.key === 'End' ? last
            : null;
        if (to === null) return;
        e.preventDefault();
        tabs.current[to]?.focus();
    };

    return (
        <nav style={{
            width: `${RAIL_WIDTH}px`,
            flexShrink: 0,
            height: '100vh',
            boxSizing: 'border-box',
            paddingTop: '76px', // the first tab lines up with the page content below the top bar
            overflowY: 'auto',
            overflowX: 'hidden',
            backgroundColor: 'var(--rail-bg)',
            // The rail's edge line, drawn inside it so the open tab (flush with the edge) covers it;
            // a real border would sit outside the scrolling box, out of the tab's reach.
            boxShadow: 'inset -1px 0 0 var(--rail-edge)',
            position: 'relative',
            zIndex: 1,
        }}>
            {family && (
                <AppsMenu
                    username={family.username}
                    apps={family.apps}
                    current={family.current}
                    accountUrl={family.accountUrl}
                    onSignOut={async () => {
                        await api.post('/auth/logout').catch(() => {});
                        signInAgain('/');
                    }}
                />
            )}
            <div role="tablist" aria-label="Account" aria-orientation="vertical" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '8px',
            }}>
                {accounts.map((account, i) => {
                    const isOpen = account.id === openId;
                    return (
                        <button
                            key={account.id}
                            ref={el => { tabs.current[i] = el; }}
                            type="button"
                            role="tab"
                            className="account-tab"
                            aria-selected={isOpen}
                            aria-label={account.email}
                            title={account.email}
                            tabIndex={isOpen ? 0 : -1}
                            onClick={() => open(account.id)}
                            onKeyDown={e => moveFocus(e, i)}
                        >
                            {labelOf(account)}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};
