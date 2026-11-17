/**
 * Menu (components.md, board C1-menu-tooltip-notice-note-band): one build for the composer, the
 * dock and every row. Padding 4; items 32 high, 14px, a 16px icon in text-3; raised; radius 8,
 * items radius 4. The most used first; a destructive item last, after a separator, in danger.
 * Keys (WAI-ARIA menu button): it opens with Enter, Space or ↓ on its button (the dock's: Shift+F10
 * or the menu key on a row); the first item (or the checked one) takes the focus; the arrows,
 * Home and End move; Enter chooses; Esc closes it and the focus goes back; Tab leaves it, closed.
 * A popover (rule L5): it also closes on a click anywhere else. Mount it while it's open.
 */
import React, { forwardRef, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useEscape, useMenuKeys } from '../utils/layers';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

export const Menu = forwardRef<HTMLDivElement, {
    label: string;
    /** Esc, Tab, or a click anywhere else */
    onClose: () => void;
    /** Where the focus goes back to after Esc: its button, or the row it's for */
    returnFocus?: () => HTMLElement | null | undefined;
    /** Its button (a click there is the button's own, not "anywhere else") */
    anchor?: React.RefObject<HTMLElement | null>;
    /** Tab leaves it, closed; or this instead */
    onTab?: (e: KeyboardEvent) => void;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}>(function Menu({ label, onClose, returnFocus, anchor, onTab, className, style, children }, ref) {
    const own = useRef<HTMLDivElement | null>(null);
    const setRef = (el: HTMLDivElement | null) => {
        own.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
    };
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; });
    useMenuKeys(own, true, e => (onTab ? onTab(e) : close.current()));
    useEscape(true, 'popover', () => {
        close.current();
        returnFocus?.()?.focus();
    });
    useEffect(() => {
        const away = (e: PointerEvent) => {
            const at = e.target as Node;
            if (own.current?.contains(at) || anchor?.current?.contains(at)) return;
            close.current();
        };
        document.addEventListener('pointerdown', away, true);
        return () => document.removeEventListener('pointerdown', away, true);
    }, [anchor]);
    return (
        <div ref={setRef} role="menu" aria-label={label} className={cx('ba-menu', className)} style={style}
            onClick={e => e.stopPropagation()}>
            {children}
        </div>
    );
});

/** An item. With `checked` (true or false) it's a choice of one (menuitemradio), with a check column. */
export const MenuItem: React.FC<{
    onSelect: () => void;
    icon?: React.ReactNode;
    checked?: boolean;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
    /** Its key, at the right */
    keys?: string;
    className?: string;
    children: React.ReactNode;
}> = ({ onSelect, icon, checked, danger, disabled, title, keys, className, children }) => {
    const choice = checked !== undefined;
    return (
        <button type="button" role={choice ? 'menuitemradio' : 'menuitem'} aria-checked={choice ? checked : undefined}
            disabled={disabled} title={title} onClick={onSelect}
            className={cx('ba-menu__item', danger && 'ba-menu__item--danger', className)}>
            {choice && <span className="ba-menu__check">{checked && <Check size={16} aria-hidden="true" />}</span>}
            {icon && <span className="ba-menu__icon">{icon}</span>}
            <span className="ba-menu__label">{children}</span>
            {keys && <span className="ba-menu__keys">{keys}</span>}
        </button>
    );
};

export const MenuSeparator: React.FC = () => <div role="separator" className="ba-menu__sep" />;
