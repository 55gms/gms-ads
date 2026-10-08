import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.js';
import { useEscape, useFocusTrap, usePresence, useScrollLock } from '../lib/hooks.js';
import { Button, IconButton } from './Button.jsx';
import { Field, Input } from './Field.jsx';

const BACKDROP = 'absolute inset-0 bg-gray-alpha-500 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in';

function Layer({ open, onClose, exitMs, labelledBy, className, panelClassName, children }) {
  const ref = useRef(null);
  const [mounted, state] = usePresence(open, exitMs);
  useEscape(open, onClose);
  useFocusTrap(mounted && open, ref);
  useScrollLock(mounted);
  if (!mounted) return null;
  return createPortal(
    <div className={cx('fixed inset-0 z-40 flex', className)}>
      <div data-motion data-state={state} className={BACKDROP} onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} data-motion data-state={state} style={{ '--pop-y': '0px' }} className={cx('relative flex flex-col bg-raised outline-none', panelClassName)}>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Modal({ open, onClose, title, description, children, footer, width = 'max-w-md' }) {
  const id = useId();
  return (
    <Layer
      open={open}
      onClose={onClose}
      exitMs={150}
      labelledBy={id}
      className="items-center justify-center p-4"
      panelClassName={cx('max-h-[calc(100dvh-32px)] w-full rounded-lg border border-gray-400 shadow-modal', 'data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in', width)}
    >
      <div className="overflow-auto p-6">
        <h2 id={id} className="heading-20">
          {title}
        </h2>
        {description && <p className="mt-2 copy-14 text-gray-900">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
      {footer && <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-gray-400 bg-background-200 px-6 py-4">{footer}</div>}
    </Layer>
  );
}

// Side sheet from the right; full screen on small viewports.
export function Sheet({ open, onClose, title, description, children, footer }) {
  const id = useId();
  return (
    <Layer
      open={open}
      onClose={onClose}
      exitMs={220}
      labelledBy={id}
      className="justify-end"
      panelClassName="h-full w-full border-l border-gray-400 shadow-modal md:w-[520px] data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-400 px-6 py-4">
        <div>
          <h2 id={id} className="heading-20">
            {title}
          </h2>
          {description && <p className="mt-1 copy-13 text-gray-900">{description}</p>}
        </div>
        <IconButton icon={X} label="Close" onClick={onClose} />
      </header>
      <div className="flex-1 overflow-auto px-6 py-6">{children}</div>
      {footer && <footer className="flex items-center justify-end gap-2 border-t border-gray-400 bg-background-200 px-6 py-4">{footer}</footer>}
    </Layer>
  );
}

// Confirmation for irreversible actions. With `confirmText`, the action stays
// disabled until that text is typed exactly.
export function ConfirmModal({ open, onClose, onConfirm, title, description, confirmLabel = 'Delete', confirmText, tone = 'error' }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState(open);
  if (open !== shownFor) {
    setShownFor(open);
    if (open) setTyped('');
  }
  const ready = !confirmText || typed === confirmText;
  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={run} loading={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmText && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <Field label={<>Type <span className="font-mono text-gray-1000">{confirmText}</span> to confirm</>}>
            {(props) => <Input {...props} data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
        </form>
      )}
    </Modal>
  );
}
