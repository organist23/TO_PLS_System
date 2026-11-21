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

function RadioGroup({ legend, name, value, options, onChange, disabled = false }) {
  return (
    <fieldset disabled={disabled}>
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
  const [saved, setSaved] = useState(null); // last saved or issued record: { id, number, formType }
  const [printing, setPrinting] = useState({ pending: false, path: '', error: '' });
  const [blanks, setBlanks] = useState({ status: 'loading', rows: [] });
  const [filling, setFilling] = useState(null); // blank record being filled in
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const busy = useRef(false);

  const loadBlanks = useCallback(async () => {
    setBlanks((b) => ({ ...b, status: 'loading' }));
    const res = await window.api.invoke('records:listBlank');
    setBlanks(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error });
  }, []);
  useEffect(() => void loadBlanks(), [loadBlanks]);

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
    setSaved(null);
    setPrinting({ pending: false, path: '', error: '' });
    const res = filling
      ? await window.api.invoke('records:fillBlank', { ...form, id: filling.id, confirmOverlap })
      : await window.api.invoke('records:create', {
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
    setSaved(res.data);
    setForm((f) => ({ ...f, ...blankDetails() }));
    if (filling) {
      setFilling(null);
      loadBlanks();
    }
  }

  async function print(id) {
    setPrinting({ pending: true, path: '', error: '' });
    const res = await window.api.invoke('records:print', { id });
    if (!res.ok) return setPrinting({ pending: false, path: '', error: res.error });
    setPrinting({ pending: false, path: res.data.canceled ? '' : res.data.path, error: '' });
  }

  async function openFile() {
    const res = await window.api.invoke('records:openExport');
    if (!res.ok) setPrinting((p) => ({ ...p, error: res.error }));
  }

  async function issueBlank() {
    setIssuing(true);
    setErrors({});
    setFormError('');
    setNotice('');
    setSaved(null);
    const res = await window.api.invoke('records:issueBlank', {
      formType: form.formType,
      issuingOffice: form.issuingOffice,
      recommendingId: Number(form.recommendingId) || null,
      approvingId: Number(form.approvingId) || null,
    });
    setIssuing(false);
    setIssueOpen(false);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    setNotice(`Issued blank ${res.data.formType} ${res.data.number}`);
    setSaved(res.data);
    loadBlanks();
    print(res.data.id);
  }

  function startFill(b) {
    setFilling(b);
    setPrinting({ pending: false, path: '', error: '' });
    setForm((f) => ({ ...f, ...blankDetails(), formType: b.formType, issuingOffice: b.issuingOffice }));
    setErrors({});
    setFormError('');
    setNotice('');
    setSaved(null);
    window.scrollTo(0, 0);
  }

  function cancelFill() {
    setFilling(null);
    setPrinting({ pending: false, path: '', error: '' });
    setErrors({});
    setForm((f) => ({ ...f, ...blankDetails() }));
  }

  const signatoryOptions = (role) =>
    lists.signatories.filter((s) => s.role === role).map((s) => (
      <option key={s.id} value={s.id}>{s.name} — {s.title}</option>
    ));

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {filling ? `Fill in ${filling.formType} ${filling.number}` : 'New record'}
      </h1>
      {notice && <Banner kind="success">{notice}</Banner>}
      {saved && (
        <div className="flex items-center gap-3">
          <button type="button" className={btn.secondary} disabled={printing.pending} onClick={() => print(saved.id)}>
            {printing.pending ? 'Printing…' : 'Print'}
          </button>
          {printing.path && (
            <>
              <span className="text-sm text-slate-700">Saved to {printing.path}</span>
              <button type="button" className={btn.link} onClick={openFile}>Open file</button>
            </>
          )}
        </div>
      )}
      {printing.error && <Banner>{printing.error}</Banner>}
      {formError && <Banner>{formError}</Banner>}

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-8 rounded-md border border-slate-200 bg-white p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <RadioGroup legend="Form" name="formType" value={form.formType} options={[['PLS', 'PLS'], ['TO', 'TO']]} disabled={!!filling}
            onChange={(v) => setForm({ ...form, formType: v })} />
          <RadioGroup legend="Issuing office" name="issuingOffice" value={form.issuingOffice} options={Object.entries(ISSUING_OFFICES)} disabled={!!filling}
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
          {lists.employees.length === 0 && <p className="text-sm text-slate-600">No active employees. Add them on Employees.</p>}
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

        {filling ? (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="font-medium text-slate-700">Recommending approval (as printed)</dt>
              <dd className="mt-1 text-slate-900">{filling.recommendingName} — {filling.recommendingTitle}</dd></div>
            <div><dt className="font-medium text-slate-700">Approved by (as printed)</dt>
              <dd className="mt-1 text-slate-900">{filling.approvingName} — {filling.approvingTitle}</dd></div>
          </dl>
        ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recommending approval" id="rec-recommendingId" error={errors.recommendingId}>
            <select {...field('recommendingId')}><option value="">Choose a signatory</option>{signatoryOptions('recommending')}</select>
            {signatoryOptions('recommending').length === 0 && (
              <p className="mt-1 text-sm text-slate-600">No active recommending signatories. Add them on Signatories.</p>
            )}
          </Field>
          <Field label="Approved by" id="rec-approvingId" error={errors.approvingId}>
            <select {...field('approvingId')}><option value="">Choose a signatory</option>{signatoryOptions('approving')}</select>
            {signatoryOptions('approving').length === 0 && (
              <p className="mt-1 text-sm text-slate-600">No active approving signatories. Add them on Signatories.</p>
            )}
          </Field>
        </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {filling ? (
            <button type="button" className={btn.secondary} onClick={cancelFill}>Cancel</button>
          ) : (
            <button type="button" className={btn.secondary} onClick={() => setIssueOpen(true)}>Issue blank form</button>
          )}
        </div>
      </form>

      <section aria-labelledby="blanks-heading" className="space-y-3">
        <h2 id="blanks-heading" className="text-base font-semibold text-slate-900">Blank forms to fill</h2>
        {blanks.status === 'loading' && <p className="text-sm text-slate-600">Loading…</p>}
        {blanks.status === 'error' && (
          <Banner action={<button className={btn.link} onClick={loadBlanks}>Retry</button>}>{blanks.error}</Banner>
        )}
        {blanks.status === 'ready' && blanks.rows.length === 0 && <p className="text-sm text-slate-600">No blank forms waiting</p>}
        {blanks.status === 'ready' && blanks.rows.length > 0 && (
          <table className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Form</th>
                <th className="px-4 py-3 font-medium">Office</th>
                <th className="px-4 py-3 font-medium">Issued</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {blanks.rows.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{b.number}</td>
                  <td className="px-4 py-3 text-slate-600">{b.formType}</td>
                  <td className="px-4 py-3 text-slate-600">{ISSUING_OFFICES[b.issuingOffice]}</td>
                  <td className="px-4 py-3 text-slate-600">{String(b.createdAt).slice(0, 16)}</td>
                  <td className="space-x-4 px-4 py-3 text-right whitespace-nowrap">
                    <button className={btn.link} aria-label={`Fill in ${b.number}`} onClick={() => startFill(b)}>Fill in</button>
                    <button className={btn.link} aria-label={`Print again ${b.number}`} disabled={printing.pending}
                      onClick={() => { setNotice(''); setSaved({ id: b.id, number: b.number, formType: b.formType }); print(b.id); }}>Print again</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={issueOpen}
        title={`Issue a blank ${form.formType} for ${ISSUING_OFFICES[form.issuingOffice]}?`}
        message="This reserves the next number."
        confirmLabel="Issue blank"
        confirmClass={btn.primary}
        pending={issuing}
        onConfirm={issueBlank}
        onCancel={() => setIssueOpen(false)}
      />

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
