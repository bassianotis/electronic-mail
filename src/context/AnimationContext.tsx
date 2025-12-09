import React, { createContext, useContext, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Rect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface AnimationContextType {
    registerBucket: (id: string, element: HTMLElement) => void;
    triggerTransfer: (startRect: Rect, bucketId: string, content: React.ReactNode) => void;
}

const AnimationContext = createContext<AnimationContextType | null>(null);

export const useAnimation = () => {
    const context = useContext(AnimationContext);
    if (!context) throw new Error('useAnimation must be used within AnimationProvider');
    return context;
};

export const AnimationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [flyingItems, setFlyingItems] = useState<{ id: number; startRect: Rect; targetRect: Rect; content: React.ReactNode }[]>([]);

    const registerBucket = (id: string, element: HTMLElement) => {
        bucketRefs.current.set(id, element);
    };

    const triggerTransfer = (startRect: Rect, bucketId: string, content: React.ReactNode) => {
        const targetEl = bucketRefs.current.get(bucketId);
        if (!targetEl) return;

        const targetRect = targetEl.getBoundingClientRect();
        const id = Date.now();

        setFlyingItems(prev => [...prev, { id, startRect, targetRect, content }]);

        // Remove after animation
        setTimeout(() => {
            setFlyingItems(prev => prev.filter(item => item.id !== id));
        }, 800);
    };

    return (
        <AnimationContext.Provider value={{ registerBucket, triggerTransfer }}>
            {children}

            {/* Flying Overlay */}
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}>
                <AnimatePresence>
                    {flyingItems.map((item) => (
                        <motion.div
                            key={item.id}
                            initial={{
                                top: item.startRect.top,
                                left: item.startRect.left,
                                width: item.startRect.width,
                                height: item.startRect.height,
                                opacity: 1,
                                scale: 1
                            }}
                            animate={{
                                top: item.targetRect.top,
                                left: item.targetRect.left,
                                width: item.targetRect.width, // Shrink to target width
                                height: item.targetRect.height,
                                opacity: 0.5,
                                scale: 0.5
                            }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} // "Garden" ease
                            style={{
                                position: 'absolute',
                                transformOrigin: 'top left',
                                overflow: 'hidden',
                                backgroundColor: '#fff', // Ensure background
                                borderRadius: 'var(--radius-md)',
                                boxShadow: 'var(--shadow-lg)'
                            }}
                        >
                            {item.content}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </AnimationContext.Provider>
    );
};
