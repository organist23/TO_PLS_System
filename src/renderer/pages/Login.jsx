import { useRef, useState } from 'react';
import { btn, inputClass, Field } from '../components/ui.jsx';

// notice: shown after a restore (US-14), which ends every session.
export default function Login({ onLogin, notice = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false); // state updates lag a fast double-click

  async function submit(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    const res = await window.api.invoke('auth:login', { username, password });
    busy.current = false;
    setPending(false);
    if (res.ok) onLogin(res.data);
    else setError(res.error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 rounded-md bg-white p-8 shadow-[0_4px_6px_hsla(0,0%,0%,.1)]">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">PLS-TO Records System</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to continue</p>
        </div>
        {notice && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="space-y-4">
          <Field label="Username" id="username">
            <input id="username" autoFocus autoComplete="username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password" id="password">
            <input id="password" type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        <button type="submit" className={`${btn.primary} w-full`} disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
