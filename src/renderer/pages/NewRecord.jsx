import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { ISSUING_OFFICES } from '../../main/signatories.js';

const MAX_EMPLOYEES = 5;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blankDetails = () => ({
  dateFiled: today(), employeeIds: [], destination: '', vehicle: '', inclusiveFrom: today(), inclusiveTo: today(),
  departureAt: '', returnAt: '', purpose: '',
});

function RadioGroup({ legend, name, value, options, onChange }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {options.map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-800">
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="size-4 accent-blue-700" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function NewRecord() {
  const [lists, setLists] = useState({ status: 'loading' });
  const [form, setForm] = useState({ formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: '', approvingId: '', ...blankDetails() });
  const [pick, setPick] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [overlaps, setOverlaps] = useState(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLists({ status: 'loading' });
    const [emps, sigs, defs] = await Promise.all([
      window.api.invoke('employees:list', {}),
      window.api.invoke('signatories:list', {}),
      window.api.invoke('signatories:defaults'),
    ]);
    const failed = [emps, sigs, defs].find((r) => !r.ok);
    if (failed) return setLists({ status: 'error', error: failed.error });
    setLists({ status: 'ready', employees: emps.data, signatories: sigs.data, defaults: defs.data });
  }, []);
  useEffect(() => void load(), [load]);

  // Signatories follow the issuing office's defaults whenever the office changes or the lists (re)load.
  useEffect(() => {
    if (lists.status !== 'ready') return;
    const d = lists.defaults[form.issuingOffice];
    setForm((f) => ({ ...f, recommendingId: d.recommending ?? '', approvingId: d.approving ?? '' }));
  }, [lists, form.issuingOffice]);

  if (lists.status === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (lists.status === 'error') {
    return <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{lists.error}</Banner>;
  }

  const byId = Object.fromEntries(lists.employees.map((e) => [e.id, e]));
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const field = (key, extra = {}) => ({
    id: `rec-${key}`,
    className: inputClass,
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `rec-${key}-error` : undefined,
    value: form[key],
    onChange: set(key),
    ...extra,
  });
  const full = form.employeeIds.length >= MAX_EMPLOYEES;

  function addEmployee() {
    const id = Number(pick);
    if (!id || full || form.employeeIds.includes(id)) return;
    setForm({ ...form, employeeIds: [...form.employeeIds, id] });
    setPick('');
  }

  async function submit(confirmOverlap = false) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setErrors({});
    setFormError('');
    setNotice('');
    const res = await window.api.invoke('records:create', {
      ...form,
      recommendingId: Number(form.recommendingId) || null,
      approvingId: Number(form.approvingId) || null,
      confirmOverlap,
    });
    busy.current = false;
    setSaving(false);
    if (res.overlaps) return setOverlaps(res.overlaps);
    setOverlaps(null);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    setNotice(`Saved ${res.data.formType} ${res.data.number}`);
    setForm((f) => ({ ...f, ...blankDetails() }));
  }

  const signatoryOptions = (role) =>
    lists.signatories.filter((s) => s.role === role).map((s) => (
      <option key={s.id} value={s.id}>{s.name} — {s.title}</option>
    ));

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">New record</h1>
      {notice && <Banner kind="success">{notice}</Banner>}
      {formError && <Banner>{formError}</Banner>}

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-8 rounded-md border border-slate-200 bg-white p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <RadioGroup legend="Form" name="formType" value={form.formType} options={[['PLS', 'PLS'], ['TO', 'TO']]}
            onChange={(v) => setForm({ ...form, formType: v })} />
          <RadioGroup legend="Issuing office" name="issuingOffice" value={form.issuingOffice} options={Object.entries(ISSUING_OFFICES)}
            onChange={(v) => setForm({ ...form, issuingOffice: v })} />
          <Field label="Date filed" id="rec-dateFiled" error={errors.dateFiled}><input type="date" {...field('dateFiled')} /></Field>
        </div>

        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Employee" id="rec-pick">
                <select id="rec-pick" className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)} disabled={full}
                  aria-describedby={errors.employees ? 'rec-employees-error' : undefined}>
                  <option value="">Choose an employee</option>
                  {lists.employees.filter((e) => !form.employeeIds.includes(e.id)).map((e) => (
                    <option key={e.id} value={e.id}>{e.fullName} — {e.officeName}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="button" className={btn.secondary} onClick={addEmployee} disabled={full || !pick}>Add</button>
          </div>
          {full && <p className="text-sm text-slate-600">At most 5 employees</p>}
          {errors.employees && <p id="rec-employees-error" className="text-sm text-red-700">{errors.employees}</p>}
          {form.employeeIds.length > 0 && (
            <ul aria-label="Employees on this record" className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {form.employeeIds.map((id) => (
                <li key={id} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                  <span>
                    <span className="font-medium text-slate-900">{byId[id]?.fullName}</span>
                    <span className="text-slate-600"> · {byId[id]?.designation || 'No designation'} · {byId[id]?.employmentStatus}</span>
                  </span>
                  <button type="button" className={btn.link} aria-label={`Remove ${byId[id]?.fullName}`}
                    onClick={() => setForm({ ...form, employeeIds: form.employeeIds.filter((x) => x !== id) })}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Destination" id="rec-destination" error={errors.destination}><input {...field('destination')} /></Field>
          <Field label="Vehicle (optional)" id="rec-vehicle" error={errors.vehicle}><input {...field('vehicle')} /></Field>
          <Field label="Inclusive from" id="rec-inclusiveFrom" error={errors.inclusiveFrom}><input type="date" {...field('inclusiveFrom')} /></Field>
          <Field label="Inclusive to" id="rec-inclusiveTo" error={errors.inclusiveTo}><input type="date" {...field('inclusiveTo')} /></Field>
          <Field label="Departure" id="rec-departureAt" error={errors.departureAt}><input type="datetime-local" {...field('departureAt')} /></Field>
          <Field label="Return (optional)" id="rec-returnAt" error={errors.returnAt}><input type="datetime-local" {...field('returnAt')} /></Field>
        </div>
        <Field label="Purpose" id="rec-purpose" error={errors.purpose}><textarea rows={3} {...field('purpose')} /></Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recommending approval" id="rec-recommendingId" error={errors.recommendingId}>
            <select {...field('recommendingId')}><option value="">Choose a signatory</option>{signatoryOptions('recommending')}</select>
          </Field>
          <Field label="Approved by" id="rec-approvingId" error={errors.approvingId}>
            <select {...field('approvingId')}><option value="">Choose a signatory</option>{signatoryOptions('approving')}</select>
          </Field>
        </div>

        <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </form>

      <ConfirmDialog
        open={!!overlaps}
        title="Possible overlap"
        message={
          <ul className="list-disc space-y-1 pl-5">
            {overlaps?.map((o) => (
              <li key={`${o.employeeName}-${o.number}-${o.formType}`}>
                {o.employeeName} already has {o.formType} {o.number} on {o.inclusiveFrom} to {o.inclusiveTo}
              </li>
            ))}
          </ul>
        }
        confirmLabel="Save anyway"
        confirmClass={btn.primary}
        pending={saving}
        onConfirm={() => submit(true)}
        onCancel={() => setOverlaps(null)}
      />
    </section>
  );
}
