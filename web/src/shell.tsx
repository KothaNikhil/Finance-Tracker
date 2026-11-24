import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Material Symbols Outlined icon, as used throughout the mocks (`<span class="ms">`). */
export function Icon({ name, className = '', fill = false }: { name: string; className?: string; fill?: boolean }) {
  return <span className={`ms${fill ? ' fill' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">{name}</span>;
}

export const TopActionsContext = createContext<HTMLElement | null>(null);

/** Renders page-specific buttons into the shell top bar (the mock's `<template id="top-actions">`). */
export function TopActions({ children }: { children: ReactNode }) {
  const target = useContext(TopActionsContext);
  return target ? createPortal(children, target) : null;
}

/**
 * Right-hand detail panel: docked on desktop, slide-over drawer on tablet, full-screen sheet on phone.
 * Render it as the last child of `.w-body`, after `<main className="w-main">`.
 */
export function DetailPanel({
  open,
  onClose,
  label,
  bar,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  bar: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('has-panel');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('has-panel');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <>
      <aside className={`w-panel${open ? ' is-open' : ''}`} aria-label={label} aria-hidden={!open}>
        {open && (
          <>
            <div className="w-panel__bar">
              {bar}
              <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label="Close" onClick={onClose}>
                <Icon name="close" />
              </button>
            </div>
            <div className="w-panel__body">{children}</div>
            {footer && <div className="w-panel__foot">{footer}</div>}
          </>
        )}
      </aside>
      <div className={`w-scrim${open ? ' is-open' : ''}`} onClick={onClose} />
    </>
  );
}

/** Indian-grouped rupee formatting identical to the mocks (₹4,59,590.40, "−" for negatives). */
export function formatInr(paise: number, options: { sign?: boolean; noPaise?: boolean } = {}): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const fixed = rupees.toFixed(options.noPaise ? 0 : 2);
  const [integer, fraction] = fixed.split('.');
  let lastThree = integer.slice(-3);
  const rest = integer.slice(0, -3);
  if (rest) lastThree = `,${lastThree}`;
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  const value = `₹${grouped}${fraction ? `.${fraction}` : ''}`;
  if (options.sign) return `${negative ? '−' : '+'}${value}`;
  return `${negative ? '−' : ''}${value}`;
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "22 Nov" */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]}`;
}

/** "22 Nov 2026" */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]} ${year}`;
}

/** "Today, 9:41 PM" / "Yesterday, 7:15 PM" / "12 Nov, 7:15 PM" */
export function friendlyDateTime(date: Date): string {
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}, ${time}`;
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
