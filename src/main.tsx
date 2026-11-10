import { StrictMode } from 'react'
import { MotionConfig } from 'framer-motion'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DURATION, tween } from './utils/motion'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <MotionConfig transition={tween(DURATION.slow)}>
                <App />
            </MotionConfig>
        </ErrorBoundary>
    </StrictMode>,
)
