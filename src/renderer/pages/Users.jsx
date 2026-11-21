import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const blank = { username: '', fullName: '', role: 'encoder', password: '' };

// US-2: admins add users, reset passwords and disable or enable accounts. user = the logged-in admin.
export default function Users({ user }) {
  const [list, setList] = useState({ status: 'loading', rows: [] });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'reset' | 'disable' | 'enable', target }
  const [confirmState, setConfirmState] = useState({ pending: false, error: '', password: '', fieldError: '' });
  const busy = useRef(false);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, status: 'loading' }));
    const res = await window.api.invoke('users:list');
    setList(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error });
  }, []);
  useEffect(() => void load(), [load]);

  const openForm = () => {
    setForm({ ...blank });
    setErrors({});
    setFormError('');
    setNotice('');
  };

  async function save(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setErrors({});
    setFormError('');
    const res = await window.api.invoke('users:create', form);
    busy.current = false;
    setSaving(false);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    setNotice(`Added ${form.username.trim()}. They must choose a new password at the first login.`);
    setForm(null);
    load();
  }

  const ask = (kind, target) => {
    setNotice('');
    setConfirm({ kind, target });
    setConfirmState({ pending: false, error: '', password: '', fieldError: '' });
  };

  async function confirmAction() {
    const { kind, target } = confirm;
    setConfirmState((s) => ({ ...s, pending: true, error: '', fieldError: '' }));
    const res = kind === 'reset'
      ? await window.api.invoke('users:resetPassword', { id: target.id, password: confirmState.password })
      : await window.api.invoke('users:setActive', { id: target.id, active: kind === 'enable' });
    if (!res.ok) {
      return setConfirmState((s) => ({ ...s, pending: false, error: res.errors ? '' : res.error, fieldError: res.errors?.password ?? '' }));
    }
    setConfirm(null);
    setNotice(kind === 'reset'
      ? `Password reset. ${target.username} must choose a new one at the next login.`
      : `${kind === 'disable' ? 'Disabled' : 'Enabled'} ${target.fullName} (${target.username})`);
    load();
  }

  const field = (key, extra = {}) => ({
    id: `usr-${key}`,
    className: inputClass,
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `usr-${key}-error` : undefined,
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
    ...extra,
  });

  const name = (u) => `${u?.fullName} (${u?.username})`;
  const dialog = confirm && {
    reset: {
      title: `Reset the password of ${confirm.target.fullName}?`,
      message: (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!confirmState.pending) confirmAction(); }}>
          <p>{confirm.target.username} will have to choose a new password at the next login. Any open session ends now.</p>
          <Field label="Temporary password" id="reset-password" error={confirmState.fieldError}>
            <input id="reset-password" type="password" autoComplete="new-password" className={inputClass} value={confirmState.password}
              aria-invalid={!!confirmState.fieldError} aria-describedby={confirmState.fieldError ? 'reset-password-error' : undefined}
              onChange={(e) => setConfirmState((s) => ({ ...s, password: e.target.value }))} />
          </Field>
        </form>
      ),
      label: 'Reset password',
      className: btn.primary,
    },
    disable: {
      title: `Disable ${name(confirm.target)}?`,
      message: 'They will not be able to log in, and any open session ends now. You can enable them again later.',
      label: 'Disable',
      className: btn.danger,
    },
    enable: {
      title: `Enable ${name(confirm.target)}?`,
      message: 'They will be able to log in again.',
      label: 'Enable',
      className: btn.primary,
    },
  }[confirm.kind];

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        {!form && <button className={btn.primary} onClick={openForm}>Add user</button>}
      </div>
      {notice && <Banner kind="success">{notice}</Banner>}

      {form && (
        <form onSubmit={save} className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">New user</h2>
          {formError && <Banner>{formError}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username" id="usr-username" error={errors.username}><input {...field('username', { autoComplete: 'off' })} /></Field>
            <Field label="Full name" id="usr-fullName" error={errors.fullName}><input {...field('fullName')} /></Field>
            <Field label="Role" id="usr-role" error={errors.role}>
              <select {...field('role')}>
                <option value="encoder">Encoder</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Temporary password" id="usr-password" error={errors.password}>
              <input type="password" {...field('password', { autoComplete: 'new-password' })} />
            </Field>
          </div>
          <p className="text-sm text-slate-600">They must choose their own password at the first login.</p>
          <div className="flex gap-3">
            <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className={btn.secondary} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {list.status === 'loading' && list.rows.length === 0 && <p className="text-sm text-slate-600">Loading…</p>}
      {list.status === 'error' && <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{list.error}</Banner>}
      {list.rows.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Full name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{u.username}</td>
                <td className="px-4 py-3 text-slate-600">{u.fullName}</td>
                <td className="px-4 py-3 text-slate-600">{u.role === 'admin' ? 'Admin' : 'Encoder'}</td>
                <td className="px-4 py-3 text-slate-600">
                  {u.active ? 'Active' : 'Disabled'}
                  {u.active && u.mustChangePassword && <span className="block text-xs text-slate-500">Must change password</span>}
                </td>
                <td className="space-x-4 px-4 py-3 text-right whitespace-nowrap">
                  {/* Not on your own row: resetting or disabling yourself would end the session you are using. */}
                  {u.id !== user.id && (
                    <>
                      <button className={btn.link} aria-label={`Reset password of ${u.username}`} onClick={() => ask('reset', u)}>Reset password</button>
                      {u.active
                        ? <button className={btn.link} aria-label={`Disable ${u.username}`} onClick={() => ask('disable', u)}>Disable</button>
                        : <button className={btn.link} aria-label={`Enable ${u.username}`} onClick={() => ask('enable', u)}>Enable</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        confirmLabel={dialog?.label ?? ''}
        confirmClass={dialog?.className}
        error={confirmState.error}
        pending={confirmState.pending}
        onConfirm={confirmAction}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
