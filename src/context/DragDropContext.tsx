import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface DragDropActions {
    setIsDragging: (isDragging: boolean) => void;
    setHoveredBucketId: (id: string | null) => void;
    /** A card has just landed on `target` ("New" drag): its row flashes and its count ticks up. */
    land: (target: string) => void;
}

interface DragDropState {
    isDragging: boolean;
    hoveredBucketId: string | null;
    landed: { target: string; at: number } | null;
}

// Two contexts: the cards only start drags (the actions never change), so a drag's state changing
// re-renders the dock and the app name, not every card in the list.
const ActionsContext = createContext<DragDropActions | undefined>(undefined);
const StateContext = createContext<DragDropState | undefined>(undefined);

export const DragDropProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);
    const [landed, setLanded] = useState<{ target: string; at: number } | null>(null);
    const land = useCallback((target: string) => setLanded({ target, at: Date.now() }), []);
    const actions = useMemo(() => ({ setIsDragging, setHoveredBucketId, land }), [land]);
    const state = useMemo(() => ({ isDragging, hoveredBucketId, landed }), [isDragging, hoveredBucketId, landed]);

    return (
        <ActionsContext.Provider value={actions}>
            <StateContext.Provider value={state}>
                {children}
            </StateContext.Provider>
        </ActionsContext.Provider>
    );
};

/** Starting and ending drags: for cards (never re-renders them). */
export const useDragDropActions = () => {
    const context = useContext(ActionsContext);
    if (!context) throw new Error('useDragDropActions must be used within a DragDropProvider');
    return context;
};

/** The actions and the drag's state: for what shows it (the dock, the app name). */
export const useDragDrop = () => {
    const actions = useContext(ActionsContext);
    const state = useContext(StateContext);
    if (!actions || !state) {
        throw new Error('useDragDrop must be used within a DragDropProvider');
    }
    return { ...actions, ...state };
};
