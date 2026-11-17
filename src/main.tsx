import { lazy, StrictMode, Suspense } from 'react'
import { MotionConfig } from 'framer-motion'
import { createRoot } from 'react-dom/client'
// Design system v2's tokens (one file for the family) first; Mail's own styles build on them
import './styles/tokens.css'
// The shared controls (one build of each: button, field, dialog, menu, notice…)
import './ui/ui.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DURATION, tween } from './utils/motion'

// The shared controls' test page (?controls): development only. In a production build DEV is false,
// so the page and its import are dropped and never reach the bundle.
const ControlsPage = import.meta.env.DEV ? lazy(() => import('./ui/ControlsPage')) : null
const CONTROLS = import.meta.env.DEV && new URLSearchParams(window.location.search).has('controls')

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            {/* reducedMotion "user": with Reduce motion on, framer keeps fades and drops movement (motion-audit.md) */}
            <MotionConfig transition={tween(DURATION.slow)} reducedMotion="user">
                {CONTROLS && ControlsPage ? <Suspense fallback={null}><ControlsPage /></Suspense> : <App />}
            </MotionConfig>
        </ErrorBoundary>
    </StrictMode>,
)
