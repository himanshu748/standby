import { useEffect, useRef, type ReactNode } from 'react';

export function Confirm({ title, children, action, busy, onCancel, onConfirm }: { title: string; children: ReactNode; action: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="confirm-title" onCancel={(e) => (e.preventDefault(), !busy && onCancel())}>
      <h2 id="confirm-title">{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="confirm-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn hot" onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? 'Working…' : action}
        </button>
      </div>
    </dialog>
  );
}
