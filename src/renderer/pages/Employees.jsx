import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { EMPLOYMENT_STATUSES } from '../../main/directory.js';

const blank = { fullName: '', designation: '', employmentStatus: 'Permanent', officeId: '' };

export default function Employees() {
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced search
  const [officeFilter, setOfficeFilter] = useState('');
  const [offices, setOffices] = useState([]);
  const [list, setList] = useState({ status: 'loading', rows: [] });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [confirmState, setConfirmState] = useState({ pending: false, error: '' });
  const busy = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    window.api.invoke('offices:list', {}).then((res) => res.ok && setOffices(res.data));
  }, []);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, status: 'loading' }));
    const res = await window.api.invoke('employees:list', { search: query, officeId: officeFilter || null, archived });
    setList(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error });
  }, [query, officeFilter, archived]);
  useEffect(() => void load(), [load]);

  const openForm = (value) => {
    setForm(value);
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
    const payload = { ...form, officeId: Number(form.officeId) || null };
    const res = await window.api.invoke(form.id ? 'employees:update' : 'employees:create', payload);
    busy.current = false;
    setSaving(false);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    setForm(null);
    setNotice('Saved');
    load();
  }

  async function archive() {
    setConfirmState({ pending: true, error: '' });
    const res = await window.api.invoke('employees:archive', { id: confirm.id });
    if (!res.ok) return setConfirmState({ pending: false, error: res.error });
    setConfirmState({ pending: false, error: '' });
    setNotice(`Archived ${confirm.fullName}`);
    setConfirm(null);
    load();
  }

  async function restore(emp) {
    setActionError('');
    const res = await window.api.invoke('employees:restore', { id: emp.id });
    if (!res.ok) return setActionError(res.error);
    setNotice(`Restored ${emp.fullName}`);
    load();
  }

  const field = (key) => ({
    id: `emp-${key}`,
    className: inputClass,
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `emp-${key}-error` : undefined,
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
        {!archived && !form && (
          <button className={btn.primary} onClick={() => openForm({ ...blank })}>Add employee</button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Show" className="inline-flex rounded-md border border-slate-300 bg-white p-1">
          {[['Active', false], ['Archived', true]].map(([label, value]) => (
            <button key={label} aria-pressed={archived === value} onClick={() => { setArchived(value); setForm(null); }}
              className={`rounded px-3 py-1 text-sm font-medium ${archived === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="w-64">
          <Field label="Search name" id="emp-search">
            <input id="emp-search" type="search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
        <div className="w-64">
          <Field label="Filter by office" id="emp-office-filter">
            <select id="emp-office-filter" className={inputClass} value={officeFilter} onChange={(e) => setOfficeFilter(e.target.value)}>
              <option value="">All offices</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {notice && <Banner kind="success">{notice}</Banner>}
      {actionError && <Banner>{actionError}</Banner>}

      {form && (
        <form onSubmit={save} className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{form.id ? 'Edit employee' : 'New employee'}</h2>
          {formError && <Banner>{formError}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" id="emp-fullName" error={errors.fullName}><input autoFocus {...field('fullName')} /></Field>
            <Field label="Designation" id="emp-designation" error={errors.designation}><input {...field('designation')} /></Field>
            <Field label="Employment status" id="emp-employmentStatus" error={errors.employmentStatus}>
              <select {...field('employmentStatus')}>
                {EMPLOYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Office" id="emp-officeId" error={errors.officeId}>
              <select {...field('officeId')}>
                <option value="">Choose an office</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
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
      {list.status === 'ready' && list.rows.length === 0 && <p className="text-sm text-slate-600">No employees found</p>}
      {list.status === 'ready' && list.rows.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Designation</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Office</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((emp) => (
              <tr key={emp.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{emp.fullName}</td>
                <td className="px-4 py-3 text-slate-600">{emp.designation}</td>
                <td className="px-4 py-3 text-slate-600">{emp.employmentStatus}</td>
                <td className="px-4 py-3 text-slate-600">{emp.officeName}</td>
                <td className="space-x-4 px-4 py-3 text-right whitespace-nowrap">
                  {archived ? (
                    <button className={btn.link} onClick={() => restore(emp)}>Restore</button>
                  ) : (
                    <>
                      <button className={btn.link} onClick={() => openForm({ id: emp.id, fullName: emp.fullName, designation: emp.designation, employmentStatus: emp.employmentStatus, officeId: String(emp.officeId) })}>Edit</button>
                      <button className={btn.link} onClick={() => { setConfirm(emp); setConfirmState({ pending: false, error: '' }); }}>Archive</button>
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
        title={`Archive ${confirm?.fullName ?? ''}?`}
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
