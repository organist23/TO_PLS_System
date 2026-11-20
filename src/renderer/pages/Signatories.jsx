import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { ISSUING_OFFICES } from '../../main/signatories.js';

const ROLE_LABEL = { recommending: 'Recommending', approving: 'Approving' };
const SLOTS = Object.entries(ISSUING_OFFICES).flatMap(([office, label]) =>
  ['recommending', 'approving'].map((role) => ({ office, role, label: `${label} — ${role}` })),
);

export default function Signatories() {
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState({ status: 'loading', rows: [] });
  const [active, setActive] = useState([]); // active signatories for the default selects
  const [defaults, setDefaults] = useState(null);
  const [defaultPending, setDefaultPending] = useState('');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [confirmState, setConfirmState] = useState({ pending: false, error: '' });
  const busy = useRef(false);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, status: 'loading' }));
    const [res, act, defs] = await Promise.all([
      window.api.invoke('signatories:list', { archived }),
      window.api.invoke('signatories:list', {}),
      window.api.invoke('signatories:defaults'),
    ]);
    const failed = [res, act, defs].find((r) => !r.ok);
    if (failed) return setList({ status: 'error', rows: [], error: failed.error });
    setList({ status: 'ready', rows: res.data });
    setActive(act.data);
    setDefaults(defs.data);
  }, [archived]);
  useEffect(() => void load(), [load]);

  const openForm = (value) => {
    setForm(value);
    setErrors({});
    setNotice('');
    setActionError('');
  };

  async function save(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setErrors({});
    setActionError('');
    const res = await window.api.invoke(form.id ? 'signatories:update' : 'signatories:create', form);
    busy.current = false;
    setSaving(false);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setActionError(res.error);
    setForm(null);
    setNotice('Saved');
    load();
  }

  async function changeDefault(slot, signatoryId) {
    const key = `${slot.office}-${slot.role}`;
    setDefaultPending(key);
    setNotice('');
    setActionError('');
    const res = await window.api.invoke('signatories:setDefault', {
      issuingOffice: slot.office, role: slot.role, signatoryId: Number(signatoryId),
    });
    setDefaultPending('');
    if (!res.ok) return setActionError(res.errors?.signatoryId ?? res.error);
    setNotice('Saved');
    load();
  }

  async function archive() {
    setConfirmState({ pending: true, error: '' });
    const res = await window.api.invoke('signatories:archive', { id: confirm.id });
    if (!res.ok) return setConfirmState({ pending: false, error: res.error });
    setConfirmState({ pending: false, error: '' });
    setNotice(`Archived ${confirm.name}`);
    setConfirm(null);
    load();
  }

  async function restore(s) {
    setActionError('');
    const res = await window.api.invoke('signatories:restore', { id: s.id });
    if (!res.ok) return setActionError(res.error);
    setNotice(`Restored ${s.name}`);
    load();
  }

  const field = (key) => ({
    id: `sig-${key}`,
    className: inputClass,
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `sig-${key}-error` : undefined,
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Signatories</h1>
        {!archived && !form && (
          <button className={btn.primary} onClick={() => openForm({ name: '', title: '', role: 'recommending' })}>
            Add signatory
          </button>
        )}
      </div>

      {notice && <Banner kind="success">{notice}</Banner>}
      {actionError && <Banner>{actionError}</Banner>}

      {defaults && (
        <div className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Defaults</h2>
            <p className="mt-1 text-sm text-slate-600">New records start with these signatories. Staff can change them per record.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SLOTS.map((slot) => {
              const key = `${slot.office}-${slot.role}`;
              return (
                <Field key={key} label={slot.label} id={`default-${key}`}>
                  <select
                    id={`default-${key}`}
                    className={inputClass}
                    disabled={defaultPending === key}
                    value={defaults[slot.office][slot.role] ?? ''}
                    onChange={(e) => changeDefault(slot, e.target.value)}
                  >
                    <option value="" disabled>Not set</option>
                    {active.filter((s) => s.role === slot.role).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} — {s.title}</option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </div>
        </div>
      )}

      <div role="group" aria-label="Show" className="inline-flex rounded-md border border-slate-300 bg-white p-1">
        {[['Active', false], ['Archived', true]].map(([label, value]) => (
          <button key={label} aria-pressed={archived === value} onClick={() => { setArchived(value); setForm(null); }}
            className={`rounded px-3 py-1 text-sm font-medium ${archived === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {form && (
        <form onSubmit={save} className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{form.id ? 'Edit signatory' : 'New signatory'}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" id="sig-name" error={errors.name}><input autoFocus {...field('name')} /></Field>
            <Field label="Title" id="sig-title" error={errors.title}><input {...field('title')} /></Field>
            <Field label="Role" id="sig-role" error={errors.role}>
              <select {...field('role')}>
                <option value="recommending">Recommending</option>
                <option value="approving">Approving</option>
              </select>
            </Field>
          </div>
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
      {list.status === 'ready' && list.rows.length === 0 && <p className="text-sm text-slate-600">No signatories found</p>}
      {list.status === 'ready' && list.rows.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.title}</td>
                <td className="px-4 py-3 text-slate-600">{ROLE_LABEL[s.role]}</td>
                <td className="space-x-4 px-4 py-3 text-right whitespace-nowrap">
                  {archived ? (
                    <button className={btn.link} onClick={() => restore(s)}>Restore</button>
                  ) : (
                    <>
                      <button className={btn.link} onClick={() => openForm({ id: s.id, name: s.name, title: s.title, role: s.role })}>Edit</button>
                      <button className={btn.link} onClick={() => { setConfirm(s); setConfirmState({ pending: false, error: '' }); }}>Archive</button>
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
