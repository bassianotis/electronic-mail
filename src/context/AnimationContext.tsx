import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DURATION, tween } from '../utils/motion';

interface Rect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface AnimationContextType {
    registerBucket: (id: string, element: HTMLElement) => void;
    /**
     * Flies `content` from `startRect` into a target: a registered bucket, else the element with
     * that id (a dock row, Archive, the app name). It shrinks as it goes and resolves once it lands.
     */
    triggerTransfer: (startRect: Rect, target: string, content: React.ReactNode) => Promise<void>;
}

/** The fly-in ("New" drag): the app's mid duration on its one curve, shrinking as it goes. */
const FLIGHT_MS = DURATION.mid * 1000;

const AnimationContext = createContext<AnimationContextType | null>(null);

export const useAnimation = () => {
    const context = useContext(AnimationContext);
    if (!context) throw new Error('useAnimation must be used within AnimationProvider');
    return context;
};

export const AnimationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [flyingItems, setFlyingItems] = useState<{ id: number; startRect: Rect; targetRect: Rect; content: React.ReactNode }[]>([]);

    const registerBucket = useCallback((id: string, element: HTMLElement) => {
        bucketRefs.current.set(id, element);
    }, []);

    const triggerTransfer = useCallback((startRect: Rect, target: string, content: React.ReactNode) => {
        const targetEl = bucketRefs.current.get(target) ?? document.getElementById(target);
        if (!targetEl) return Promise.resolve();
        const r = targetEl.getBoundingClientRect();
        // Into the target's middle, the same size, shrunk by the scale
        const targetRect = { top: r.top + r.height / 2 - startRect.height / 2, left: r.left + r.width / 2 - startRect.width / 2, width: startRect.width, height: startRect.height };
        const id = Date.now() + Math.random();
        setFlyingItems(prev => [...prev, { id, startRect, targetRect, content }]);
        return new Promise<void>(resolve => {
            setTimeout(() => {
                setFlyingItems(prev => prev.filter(item => item.id !== id));
                resolve();
            }, FLIGHT_MS);
        });
    }, []);

    // Stable, so a flight starting doesn't re-render every card that can start one
    const value = useMemo(() => ({ registerBucket, triggerTransfer }), [registerBucket, triggerTransfer]);

    return (
        <AnimationContext.Provider value={value}>
            {children}

            {/* Flying Overlay */}
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
                <AnimatePresence>
                    {flyingItems.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                            animate={{ x: item.targetRect.left - item.startRect.left, y: item.targetRect.top - item.startRect.top, opacity: 0.5, scale: 0.3 }}
                            exit={{ opacity: 0, transition: tween(DURATION.fast) }}
                            transition={tween(FLIGHT_MS / 1000)}
                            style={{ position: 'absolute', top: item.startRect.top, left: item.startRect.left, width: item.startRect.width, height: item.startRect.height, transformOrigin: 'center' }}
                        >
                            {item.content}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </AnimationContext.Provider>
    );
};
