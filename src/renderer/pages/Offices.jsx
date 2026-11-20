import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function Offices() {
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState({ status: 'loading', rows: [] });
  const [form, setForm] = useState(null); // null | { id?, name }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState(null); // office being archived
  const [confirmState, setConfirmState] = useState({ pending: false, error: '' });
  const busy = useRef(false);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, status: 'loading' }));
    const res = await window.api.invoke('offices:list', { archived });
    setList(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error });
  }, [archived]);
  useEffect(() => void load(), [load]);

  async function save(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setErrors({});
    setNotice('');
    const res = await window.api.invoke(form.id ? 'offices:update' : 'offices:create', form);
    busy.current = false;
    setSaving(false);
    if (!res.ok) return setErrors(res.errors ?? { name: res.error });
    setForm(null);
    setNotice('Saved');
    load();
  }

  async function archive() {
    setConfirmState({ pending: true, error: '' });
    const res = await window.api.invoke('offices:archive', { id: confirm.id });
    if (!res.ok) return setConfirmState({ pending: false, error: res.error });
    setConfirmState({ pending: false, error: '' });
    setNotice(`Archived ${confirm.name}`);
    setConfirm(null);
    load();
  }

  async function restore(o) {
    setActionError('');
    const res = await window.api.invoke('offices:restore', { id: o.id });
    if (!res.ok) return setActionError(res.error);
    setNotice(`Restored ${o.name}`);
    load();
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Offices</h1>
        {!archived && !form && (
          <button className={btn.primary} onClick={() => { setForm({ name: '' }); setErrors({}); setNotice(''); }}>
            Add office
          </button>
        )}
      </div>

      <div role="group" aria-label="Show" className="inline-flex rounded-md border border-slate-300 bg-white p-1">
        {[['Active', false], ['Archived', true]].map(([label, value]) => (
          <button key={label} aria-pressed={archived === value} onClick={() => { setArchived(value); setForm(null); }}
            className={`rounded px-3 py-1 text-sm font-medium ${archived === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {notice && <Banner kind="success">{notice}</Banner>}
      {actionError && <Banner>{actionError}</Banner>}

      {form && (
        <form onSubmit={save} className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{form.id ? 'Edit office' : 'New office'}</h2>
          <Field label="Office name" id="office-name" error={errors.name}>
            <input id="office-name" autoFocus className={inputClass} aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'office-name-error' : undefined}
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="flex gap-3">
            <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className={btn.secondary} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {list.status === 'loading' && <p className="text-sm text-slate-600">Loading…</p>}
      {list.status === 'error' && (
        <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{list.error}</Banner>
      )}
      {list.status === 'ready' && list.rows.length === 0 && <p className="text-sm text-slate-600">No offices found</p>}
      {list.status === 'ready' && list.rows.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Active employees</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                <td className="px-4 py-3 text-slate-600">{o.activeEmployees}</td>
                <td className="space-x-4 px-4 py-3 text-right">
                  {archived ? (
                    <button className={btn.link} onClick={() => restore(o)}>Restore</button>
                  ) : (
                    <>
                      <button className={btn.link} onClick={() => { setForm({ id: o.id, name: o.name }); setErrors({}); setNotice(''); }}>Edit</button>
                      <button className={btn.link} onClick={() => { setConfirm(o); setConfirmState({ pending: false, error: '' }); }}>Archive</button>
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
        title={`Archive ${confirm?.name ?? ''}?`}
        message="It will be hidden from pick lists. You can restore it from Archived."
        confirmLabel="Archive"
        error={confirmState.error}
        pending={confirmState.pending}
        onConfirm={archive}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
