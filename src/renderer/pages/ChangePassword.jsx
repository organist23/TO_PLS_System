import { useRef, useState } from 'react';
import { btn, inputClass, Field } from '../components/ui.jsx';

export default function ChangePassword({ onDone, onLogout }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function submit(e) {
    e.preventDefault();
    if (busy.current) return;
    if (newPassword !== confirm) return setErrors({ confirm: 'Passwords do not match' });
    busy.current = true;
    setPending(true);
    setErrors({});
    setError('');
    const res = await window.api.invoke('auth:changePassword', { newPassword });
    busy.current = false;
    setPending(false);
    if (res.ok) return onDone();
    if (res.errors) setErrors(res.errors);
    else setError(res.error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 rounded-md bg-white p-8 shadow-[0_4px_6px_hsla(0,0%,0%,.1)]">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-600">You must change the default password before continuing.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="space-y-4">
          <Field label="New password" id="newPassword" error={errors.newPassword}>
            <input id="newPassword" type="password" autoFocus autoComplete="new-password" className={inputClass} aria-invalid={!!errors.newPassword} aria-describedby={errors.newPassword ? 'newPassword-error' : undefined} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" id="confirm" error={errors.confirm}>
            <input id="confirm" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'confirm-error' : undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">
          <button type="submit" className={`${btn.primary} w-full`} disabled={pending}>
            {pending ? 'Saving…' : 'Save password'}
          </button>
          <button type="button" className={`${btn.link} w-full`} onClick={onLogout}>
            Log out
          </button>
        </div>
      </form>
    </main>
  );
}
