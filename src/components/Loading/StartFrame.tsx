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
        <div aria-busy="true" aria-label="Loading" style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
            {shown && (
                <>
                    <div style={{
                        width: RAIL_WIDTH,
                        flexShrink: 0,
                        paddingTop: '76px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '8px',
                        backgroundColor: 'var(--rail-bg)',
                        boxShadow: 'inset -1px 0 0 var(--rail-edge)',
                    }}>
                        <Bone w={32} h={96} r="var(--radius-control) 0 0 var(--radius-control)" />
                        <Bone w={32} h={84} r="var(--radius-control) 0 0 var(--radius-control)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                        <div style={{ height: 64, display: 'grid', gridTemplateColumns: '1fr minmax(auto, 480px) 1fr', alignItems: 'center', padding: '0 var(--space-lg)' }}>
                            <Bone w={150} h={20} style={{ marginLeft: 12 }} />
                            <Bone w="100%" h={42} />
                            <span style={{ justifySelf: 'end', display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                                <Bone w={114} h={34} />
                                <Bone w={24} h={24} />
                            </span>
                        </div>
                        <div style={{ maxWidth: '800px', width: '100%', margin: '0 auto', paddingTop: 'var(--space-xl)' }}>
                            <Bone w={110} h={28} r="var(--radius-sm)" style={{ marginBottom: 'var(--space-lg)' }} />
                            <InboxCardSkeleton />
                            <InboxCardSkeleton />
                            <InboxCardSkeleton />
                        </div>
                        <div style={{
                            position: 'absolute',
                            bottom: 'var(--space-lg)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex',
                            gap: '12px',
                            padding: '12px 16px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--surface-card)',
                        }}>
                            {[0, 1, 2, 3, 4].map(i => <Bone key={i} w={48} h={48} r="var(--radius-md)" />)}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
