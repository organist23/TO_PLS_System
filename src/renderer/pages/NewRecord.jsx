import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePrint } from '../components/PrintFlow.jsx';
import { ISSUING_OFFICES } from '../../main/signatories.js';

const MAX_EMPLOYEES = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (period) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
const DEPT_HEAD_ON_PAPER = 'Department Head (signs on the paper)';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toLocal = (dt) => (dt ? dt.slice(0, 16).replace(' ', 'T') : ''); // 'YYYY-MM-DD HH:MM:SS' -> datetime-local
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

// params: {} for a new record, { mode: 'edit' | 'fill', id } when opened from Records.
export default function NewRecord({ params = {}, go }) {
  const [lists, setLists] = useState({ status: 'loading' });
  const [form, setForm] = useState({ formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: '', approvingId: '', ...blankDetails() });
  const [pick, setPick] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [overlaps, setOverlaps] = useState(null);
  const [saved, setSaved] = useState(null); // last saved or issued record: { id, number, formType }
  const { print, printing, resetPrinting, openFile, dialog: previewDialog } = usePrint();
  const [blanks, setBlanks] = useState({ status: 'loading', rows: [] });
  const [filling, setFilling] = useState(null); // blank record being filled in
  const [editing, setEditing] = useState(null); // filled record being edited (records:get row)
  const [gone, setGone] = useState(''); // the record params.id names cannot be edited or filled
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueCount, setIssueCount] = useState('1');
  const [estimate, setEstimate] = useState(null); // numbers the stack would get: { first, last } | 'loading' | { error }
  const [lookup, setLookup] = useState({ formType: 'PLS', number: '', pending: false, error: '', encodedId: null });
  const [months, setMonths] = useState([]); // past months with unused blanks (US-18)
  const [deleting, setDeleting] = useState(null); // { period, count, pending, error }
  const busy = useRef(false);

  const loadBlanks = useCallback(async () => {
    setBlanks((b) => ({ ...b, status: 'loading' }));
    const [res, unused] = await Promise.all([window.api.invoke('records:listBlank'), window.api.invoke('records:unusedBlanks')]);
    setBlanks(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error });
    setMonths(unused.ok ? unused.data : []);
  }, []);
  useEffect(() => void loadBlanks(), [loadBlanks]);

  const load = useCallback(async () => {
    setLists({ status: 'loading' });
    const [emps, sigs, defs, rec] = await Promise.all([
      window.api.invoke('employees:list', {}),
      window.api.invoke('signatories:list', {}),
      window.api.invoke('signatories:defaults'),
      params.id ? window.api.invoke('records:get', { id: params.id }) : { ok: true, data: null },
    ]);
    const failed = [emps, sigs, defs].find((r) => !r.ok);
    if (failed) return setLists({ status: 'error', error: failed.error });
    if (params.id) {
      const r = rec.ok ? rec.data : null;
      const active = r && !r.archived_at;
      if (params.mode === 'edit' && active && r.status === 'filled') {
        setEditing(r);
        setForm({
          formType: r.form_type, issuingOffice: r.issuing_office,
          recommendingId: String(r.recommending_id), approvingId: String(r.approving_id),
          dateFiled: r.date_filed, employeeIds: r.employees.map((e) => e.employee_id), destination: r.destination,
          vehicle: r.vehicle, inclusiveFrom: r.inclusive_from, inclusiveTo: r.inclusive_to,
          departureAt: toLocal(r.departure_at), returnAt: toLocal(r.return_at), purpose: r.purpose,
        });
      } else if (params.mode === 'fill' && active && r.status === 'blank') {
        setFilling({
          id: r.id, number: r.number, formType: r.form_type, issuingOffice: r.issuing_office,
          recommendingName: r.recommending_name, recommendingTitle: r.recommending_title,
          approvingName: r.approving_name, approvingTitle: r.approving_title,
        });
        setForm((f) => ({ ...f, ...blankDetails(), formType: r.form_type, issuingOffice: r.issuing_office, recommendingId: '' }));
      } else {
        setGone(!rec.ok ? rec.error : params.mode === 'fill' ? 'This blank form is no longer available.' : 'This record can no longer be edited.');
      }
    }
    setLists({ status: 'ready', employees: emps.data, signatories: sigs.data, defaults: defs.data });
  }, [params.id, params.mode]);
  useEffect(() => void load(), [load]);

  // Signatories follow the issuing office's defaults whenever the office changes or the lists (re)load.
  // An edit keeps the record's signatories; a blank being filled has its own (and no default Department Head).
  useEffect(() => {
    if (lists.status !== 'ready' || params.mode === 'edit' || filling) return;
    const d = lists.defaults[form.issuingOffice];
    setForm((f) => ({ ...f, recommendingId: d.recommending ?? '', approvingId: d.approving ?? '' }));
  }, [lists, form.issuingOffice, filling]);

  if (lists.status === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (lists.status === 'error') {
    return <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{lists.error}</Banner>;
  }
  if (gone) return <Banner action={<button className={btn.link} onClick={() => go('records')}>Back to records</button>}>{gone}</Banner>;

  // People already on an edited record show their saved details, even if archived since (US-8).
  const byId = Object.fromEntries([
    ...lists.employees.map((e) => [e.id, e]),
    ...(editing?.employees ?? []).map((e) => [e.employee_id, { fullName: e.full_name, designation: e.designation, employmentStatus: e.employment_status }]),
  ]);
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
    resetPrinting();
    const withSigners = { ...form, recommendingId: Number(form.recommendingId) || null, approvingId: Number(form.approvingId) || null, confirmOverlap };
    const res = filling
      ? await window.api.invoke('records:fillBlank', { ...withSigners, id: filling.id })
      : editing
        ? await window.api.invoke('records:update', { ...withSigners, id: editing.id })
        : await window.api.invoke('records:create', withSigners);
    busy.current = false;
    setSaving(false);
    if (res.overlaps) return setOverlaps(res.overlaps);
    setOverlaps(null);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    // Opened from Records: return to the record, where Print is.
    if (editing || params.mode) return go('records', { openId: res.data.id, notice: `Saved ${res.data.formType} ${res.data.number}` });
    setNotice(`Saved ${res.data.formType} ${res.data.number}`);
    setSaved(res.data);
    setForm((f) => ({ ...f, ...blankDetails() }));
    if (filling) {
      setFilling(null);
      loadBlanks();
    }
  }

  // The confirmation shows the numbers the stack would get; the server assigns the real ones (US-16).
  async function openIssue() {
    setIssueOpen(true);
    setEstimate('loading');
    const res = await window.api.invoke('records:nextNumbers', { formType: form.formType, issuingOffice: form.issuingOffice, count: issueCount });
    setEstimate(res.ok ? res.data : { error: res.error });
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
      count: issueCount,
    });
    setIssuing(false);
    setIssueOpen(false);
    if (!res.ok) return res.errors ? setErrors(res.errors) : setFormError(res.error);
    const { formType, ids, numbers } = res.data;
    setNotice(ids.length === 1
      ? `Issued blank ${formType} ${numbers[0]}`
      : `Issued ${ids.length} blank ${formType}: ${numbers[0]} to ${numbers[numbers.length - 1]}`);
    const rec = { id: ids[0], number: numbers[0], formType, ids };
    setSaved(rec);
    loadBlanks();
    print(rec);
  }

  // US-17: the number printed on a returned form opens its Fill in.
  async function findReturned(e) {
    e.preventDefault();
    setLookup((l) => ({ ...l, pending: true, error: '', encodedId: null }));
    const res = await window.api.invoke('records:findBlank', { formType: lookup.formType, number: lookup.number });
    const done = { pending: false, error: '', encodedId: null };
    if (!res.ok) return setLookup((l) => ({ ...l, ...done, error: res.error }));
    const b = res.data;
    if (b.status === 'filled') return setLookup((l) => ({ ...l, ...done, error: `${b.number} is already encoded.`, encodedId: b.id }));
    if (b.archived) return setLookup((l) => ({ ...l, ...done, error: `${b.number} was voided.` }));
    setLookup((l) => ({ ...l, ...done, number: '' }));
    startFill(b);
  }

  async function deleteMonth() {
    setDeleting((d) => ({ ...d, pending: true, error: '' }));
    const res = await window.api.invoke('records:deleteUnusedBlanks', { period: deleting.period });
    if (!res.ok) return setDeleting((d) => ({ ...d, pending: false, error: res.error }));
    setDeleting(null);
    setNotice(`Deleted ${res.data.deleted} unused blanks of ${monthLabel(res.data.period)}`);
    loadBlanks();
  }

  function startFill(b) {
    setFilling(b);
    resetPrinting();
    setForm((f) => ({ ...f, ...blankDetails(), formType: b.formType, issuingOffice: b.issuingOffice, recommendingId: '' }));
    setErrors({});
    setFormError('');
    setNotice('');
    setSaved(null);
    window.scrollTo(0, 0);
  }

  function cancelFill() {
    if (params.mode) return go('records', { openId: params.id });
    setFilling(null);
    resetPrinting();
    setErrors({});
    setForm((f) => ({ ...f, ...blankDetails() }));
  }

  // An edited record keeps its saved signatory as an option, shown as saved, even if archived since.
  const signatoryOptions = (role) => {
    const savedId = editing?.[`${role}_id`];
    const active = lists.signatories.filter((s) => s.role === role);
    const options = active.filter((s) => s.id !== savedId).map((s) => (
      <option key={s.id} value={s.id}>{s.name} — {s.title}</option>
    ));
    if (!savedId) return options;
    const archived = active.some((s) => s.id === savedId) ? '' : ' (archived)';
    return [
      <option key={savedId} value={savedId}>{editing[`${role}_name`]} — {editing[`${role}_title`]}{archived}</option>,
      ...options,
    ];
  };

  const signerName = (id) => {
    const s = lists.signatories.find((x) => x.id === Number(id));
    return s ? `${s.name} — ${s.title}` : 'Not chosen';
  };
  const count = Number(issueCount);
  const mayorStack = form.issuingOffice === 'MAYOR';

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {filling ? `Fill in ${filling.formType} ${filling.number}` : editing ? `Edit ${editing.form_type} ${editing.number}` : 'New record'}
      </h1>
      {notice && <Banner kind="success">{notice}</Banner>}
      {saved && (
        <div className="flex items-center gap-3">
          <button type="button" className={btn.secondary} disabled={printing.pending} onClick={() => print(saved)}>
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
          <RadioGroup legend="Form" name="formType" value={form.formType} options={[['PLS', 'PLS'], ['TO', 'TO']]} disabled={!!filling || !!editing}
            onChange={(v) => setForm({ ...form, formType: v })} />
          <RadioGroup legend="Issuing office" name="issuingOffice" value={form.issuingOffice} options={Object.entries(ISSUING_OFFICES)} disabled={!!filling || !!editing}
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
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {filling.recommendingName == null ? (
              <Field label="Recommending approval (Department Head who signed)" id="rec-recommendingId" error={errors.recommendingId}>
                <select {...field('recommendingId')}><option value="">Choose the Department Head</option>{signatoryOptions('recommending')}</select>
              </Field>
            ) : (
              <div><p className="font-medium text-slate-700">Recommending approval (as printed)</p>
                <p className="mt-1 text-slate-900">{filling.recommendingName} — {filling.recommendingTitle}</p></div>
            )}
            <div><p className="font-medium text-slate-700">Approved by (as printed)</p>
              <p className="mt-1 text-slate-900">{filling.approvingName} — {filling.approvingTitle}</p></div>
          </div>
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
          {filling || editing ? (
            <button type="button" className={btn.secondary} onClick={editing ? () => go('records', { openId: editing.id }) : cancelFill}>Cancel</button>
          ) : (
            <div className="flex items-start gap-3">
              <label htmlFor="rec-count" className="pt-2 text-sm font-medium text-slate-700">How many</label>
              <div className="w-24">
                <input id="rec-count" type="number" min="1" max="50" className={`${inputClass} mt-0`}
                  value={issueCount} onChange={(e) => setIssueCount(e.target.value)}
                  aria-invalid={!!errors.count} aria-describedby={errors.count ? 'rec-count-error' : undefined} />
                {errors.count && <p id="rec-count-error" className="mt-1 text-sm text-red-700">{errors.count}</p>}
              </div>
              <button type="button" className={btn.secondary} onClick={openIssue}>Issue blank form</button>
            </div>
          )}
        </div>
      </form>

      {!editing && !params.mode && (
      <form onSubmit={findReturned} aria-labelledby="encode-heading" className="space-y-3 rounded-md border border-slate-200 bg-white p-6">
        <h2 id="encode-heading" className="text-base font-semibold text-slate-900">Encode a returned form</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field label="Form" id="enc-form">
              <select id="enc-form" className={inputClass} value={lookup.formType} onChange={(e) => setLookup({ ...lookup, formType: e.target.value })}>
                <option value="PLS">PLS</option>
                <option value="TO">TO</option>
              </select>
            </Field>
          </div>
          <div className="w-64">
            <Field label="Number on the returned form" id="enc-number">
              <input id="enc-number" className={inputClass} value={lookup.number} placeholder="2026-11-25"
                onChange={(e) => setLookup({ ...lookup, number: e.target.value, error: '', encodedId: null })}
                aria-invalid={!!lookup.error} aria-describedby={lookup.error ? 'enc-number-error' : undefined} />
            </Field>
          </div>
          <button type="submit" className={btn.secondary} disabled={lookup.pending || !lookup.number.trim()}>
            {lookup.pending ? 'Finding…' : 'Find'}
          </button>
        </div>
        {lookup.error && (
          <p id="enc-number-error" role="alert" className="text-sm text-red-700">
            {lookup.error}{' '}
            {lookup.encodedId && <button type="button" className={btn.link} onClick={() => go('records', { openId: lookup.encodedId })}>Open</button>}
          </p>
        )}
      </form>
      )}

      {!editing && !params.mode && (
      <section aria-labelledby="blanks-heading" className="space-y-3">
        <h2 id="blanks-heading" className="text-base font-semibold text-slate-900">Blank forms to fill</h2>
        {months.map((m) => (
          <div key={m.period}>
            <button type="button" className={btn.danger} onClick={() => setDeleting({ ...m, pending: false, error: '' })}>
              Delete {m.count} unused blanks of {monthLabel(m.period)}
            </button>
          </div>
        ))}
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
                      onClick={() => { const rec = { id: b.id, number: b.number, formType: b.formType }; setNotice(''); setSaved(rec); print(rec); }}>Print again</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      )}

      {previewDialog}

      <ConfirmDialog
        open={issueOpen}
        title={count > 1
          ? `Issue ${count} blank ${form.formType} for ${ISSUING_OFFICES[form.issuingOffice]}?`
          : `Issue a blank ${form.formType} for ${ISSUING_OFFICES[form.issuingOffice]}?`}
        message={
          <div className="space-y-1">
            <p>
              {estimate === 'loading' ? 'Checking numbers…'
                : estimate?.error ? estimate.error
                  : count > 1 ? `Numbers: ${estimate?.first} to ${estimate?.last}` : `Number: ${estimate?.first}`}
            </p>
            <p>Recommending approval: {mayorStack ? DEPT_HEAD_ON_PAPER : signerName(form.recommendingId)}</p>
            <p>Approved by: {signerName(form.approvingId)}</p>
            <p>This reserves {count > 1 ? `${count} numbers` : 'the next number'}.</p>
          </div>
        }
        confirmLabel={count > 1 ? `Issue ${count} blanks` : 'Issue blank'}
        confirmClass={btn.primary}
        pending={issuing}
        onConfirm={issueBlank}
        onCancel={() => setIssueOpen(false)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Delete ${deleting.count} unused blanks of ${monthLabel(deleting.period)}?` : ''}
        message="Their numbers were never used. This cannot be undone."
        confirmLabel="Delete"
        error={deleting?.error}
        pending={deleting?.pending}
        onConfirm={deleteMonth}
        onCancel={() => setDeleting(null)}
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
