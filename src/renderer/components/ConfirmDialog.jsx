import { useEffect, useRef } from 'react';
import { btn } from './ui.jsx';

export default function ConfirmDialog({ open, title, message, confirmLabel, error, pending, onConfirm, onCancel, confirmClass = btn.danger }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault(); // Escape: let React state close it
        onCancel();
      }}
      className="m-auto w-full max-w-md rounded-md p-6 shadow-[0_15px_35px_hsla(0,0%,0%,.2)] backdrop:bg-slate-900/40"
    >
      <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      <div className="mt-2 text-sm text-slate-600">{message}</div>
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-3">
        {open && (
          <button type="button" autoFocus className={btn.secondary} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className={confirmClass} disabled={pending} onClick={onConfirm}>
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
