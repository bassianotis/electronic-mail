/**
 * The start frame (Explore 1, 5a): while the app waits for the engine at start (the session
 * check, then the account list), a slow wait shows the frame's shapes (rail, top bar, dock) and a
 * few Inbox card skeletons. A brief wait stays blank; it never shows the login form by mistake.
 */
import { useAfter } from '../../hooks/useAfter';
import { Bone, InboxCardSkeleton } from './Skeletons';
import { RAIL_WIDTH } from '../Layout/AccountRail';

export const StartFrame = () => {
    const shown = useAfter();
    return (
        <div aria-busy="true" aria-label="Loading" style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--bg-page)', overflow: 'hidden' }}>
            {shown && (
                <>
                    <div style={{
                        width: RAIL_WIDTH,
                        flexShrink: 0,
                        paddingTop: '76px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 'var(--space-2)',
                        backgroundColor: 'var(--bg-rail)',
                        boxShadow: 'inset -1px 0 0 transparent',
                    }}>
                        <Bone w={32} h={96} r="var(--radius-2) 0 0 var(--radius-2)" />
                        <Bone w={32} h={84} r="var(--radius-2) 0 0 var(--radius-2)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                        <div style={{ height: 64, display: 'grid', gridTemplateColumns: '1fr minmax(auto, 480px) 1fr', alignItems: 'center', padding: '0 var(--space-6)' }}>
                            <Bone w={150} h={20} style={{ marginLeft: 'var(--space-3)' }} />
                            <Bone w="100%" h={42} />
                            <span style={{ justifySelf: 'end', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                <Bone w={114} h={34} />
                                <Bone w={24} h={24} />
                            </span>
                        </div>
                        <div style={{ maxWidth: '800px', width: '100%', margin: '0 auto', paddingTop: 'var(--space-8)' }}>
                            <Bone w={110} h={28} r="var(--radius-2)" style={{ marginBottom: 'var(--space-6)' }} />
                            <InboxCardSkeleton />
                            <InboxCardSkeleton />
                            <InboxCardSkeleton />
                        </div>
                        <div style={{
                            position: 'absolute',
                            bottom: 'var(--space-6)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-3) var(--space-4)',
                            borderRadius: 'var(--radius-3)',
                            border: '1px solid var(--line-1)',
                            backgroundColor: 'var(--surface-1)',
                        }}>
                            {[0, 1, 2, 3, 4].map(i => <Bone key={i} w={48} h={48} r="var(--radius-3)" />)}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
