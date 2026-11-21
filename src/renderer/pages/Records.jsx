import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePrint } from '../components/PrintFlow.jsx';
import { ISSUING_OFFICES } from '../../main/signatories.js';

const STATUSES = [['active', 'Active'], ['filled', 'Filled'], ['blank', 'Blank issued'], ['archived', 'Archived']];
const NO_FILTERS = { search: '', formType: '', issuingOffice: '', officeId: '', from: '', to: '', status: 'active' };
const statusLabel = (r) => (r.archived ? 'Archived' : r.status === 'blank' ? 'Blank issued' : 'Filled');
const travel = (from, to) => (from ? `${from} to ${to}` : '—');
const dateTime = (dt) => (dt ? dt.slice(0, 16) : '—');

// params: { openId, notice } when coming back from an edit or fill.
export default function Records({ params = {}, go }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [query, setQuery] = useState(NO_FILTERS); // debounced filters
  const [list, setList] = useState({ status: 'loading', rows: [], truncated: false });
  const [offices, setOffices] = useState([]);
  const [detail, setDetail] = useState(params.openId ? { status: 'loading', id: params.openId } : null);
  const [notice, setNotice] = useState(params.notice ?? '');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [overlaps, setOverlaps] = useState(null); // restore would overlap these active records
  const [acting, setActing] = useState({ pending: false, error: '' });
  const { print, printing, resetPrinting, openFile, dialog: previewDialog } = usePrint();
  const listSeq = useRef(0);
  const detailSeq = useRef(0); // a detail still loading after Back to list or another Open is dropped

  useEffect(() => {
    const t = setTimeout(() => setQuery(filters), 250);
    return () => clearTimeout(t);
  }, [filters]);

  const loadList = useCallback(async () => {
    const seq = ++listSeq.current;
    setList((l) => ({ ...l, status: 'loading' }));
    const res = await window.api.invoke('records:list', { ...query, officeId: Number(query.officeId) || null });
    if (seq !== listSeq.current) return; // a newer search is on its way
    if (res.ok) setList({ status: 'ready', ...res.data });
    else setList({ status: 'error', rows: [], truncated: false, error: res.error, errors: res.errors });
  }, [query]);
  useEffect(() => void loadList(), [loadList]);

  const [officesError, setOfficesError] = useState('');
  const loadOffices = useCallback(async () => {
    const res = await window.api.invoke('offices:list', {});
    setOfficesError(res.ok ? '' : res.error);
    if (res.ok) setOffices(res.data);
  }, []);
  useEffect(() => void loadOffices(), [loadOffices]);

  const openRecord = useCallback(async (id) => {
    const seq = ++detailSeq.current;
    setDetail({ status: 'loading', id });
    setActing({ pending: false, error: '' });
    resetPrinting();
    const res = await window.api.invoke('records:get', { id });
    if (seq !== detailSeq.current) return;
    setDetail(res.ok ? { status: 'ready', id, rec: res.data } : { status: 'error', id, error: res.error });
    window.scrollTo(0, 0);
  }, []); // resetPrinting only calls a state setter
  useEffect(() => {
    if (params.openId) openRecord(params.openId);
  }, [params.openId, openRecord]);

  function backToList() {
    detailSeq.current++;
    setDetail(null);
    setNotice('');
    loadList();
  }

  async function setArchived(archive, confirmOverlap = false) {
    const rec = detail.rec;
    setActing({ pending: true, error: '' });
    const res = await window.api.invoke(archive ? 'records:archive' : 'records:restore', { id: rec.id, confirmOverlap });
    if (res.overlaps) {
      setActing({ pending: false, error: '' });
      return setOverlaps(res.overlaps);
    }
    setActing({ pending: false, error: res.ok ? '' : res.error });
    if (!res.ok) return;
    setArchiveOpen(false);
    setOverlaps(null);
    if (archive) {
      setDetail(null);
      setNotice(`Archived ${rec.number}`);
      loadList();
    } else {
      await openRecord(rec.id);
      setNotice(`Restored ${rec.number}`);
    }
  }

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  const filter = (key, label, input) => (
    <div className="w-44">
      <Field label={label} id={`flt-${key}`} error={list.errors?.[key]}>{input}</Field>
    </div>
  );
  const select = (key, options) => (
    <select id={`flt-${key}`} className={inputClass} value={filters[key]} onChange={set(key)}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );

  if (detail) {
    const rec = detail.rec;
    return (
      <section className="space-y-6">
        <button type="button" className={btn.link} onClick={backToList}>Back to list</button>
        {notice && <Banner kind="success">{notice}</Banner>}
        {detail.status === 'loading' && <p className="text-sm text-slate-600">Loading…</p>}
        {detail.status === 'error' && (
          <Banner action={<button className={btn.link} onClick={() => openRecord(detail.id)}>Retry</button>}>{detail.error}</Banner>
        )}
        {rec && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-slate-900">{rec.form_type} {rec.number}</h1>
              <div className="flex gap-3">
                {rec.archived_at ? (
                  <button type="button" className={btn.primary} disabled={acting.pending} onClick={() => setArchived(false)}>
                    {acting.pending ? 'Restoring…' : 'Restore'}
                  </button>
                ) : (
                  <>
                    {rec.status === 'blank' ? (
                      <button type="button" className={btn.primary} onClick={() => go('newRecord', { mode: 'fill', id: rec.id })}>Fill in</button>
                    ) : (
                      <button type="button" className={btn.primary} onClick={() => go('newRecord', { mode: 'edit', id: rec.id })}>Edit</button>
                    )}
                    <button type="button" className={btn.secondary} disabled={printing.pending}
                      onClick={() => print({ id: rec.id, number: rec.number, formType: rec.form_type })}>
                      {printing.pending ? 'Printing…' : 'Print'}
                    </button>
                    <button type="button" className={btn.secondary} onClick={() => { setActing({ pending: false, error: '' }); setArchiveOpen(true); }}>
                      Archive
                    </button>
                  </>
                )}
              </div>
            </div>
            {printing.path && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-700">Saved to {printing.path}</span>
                <button type="button" className={btn.link} onClick={openFile}>Open file</button>
              </div>
            )}
            {printing.error && <Banner>{printing.error}</Banner>}
            {!archiveOpen && !overlaps && acting.error &&<Banner>{acting.error}</Banner>}

            <dl className="grid gap-4 rounded-md border border-slate-200 bg-white p-6 text-sm sm:grid-cols-2">
              {[
                ['Status', statusLabel({ archived: !!rec.archived_at, status: rec.status })],
                ['Issuing office', ISSUING_OFFICES[rec.issuing_office]],
                ['Date filed', rec.date_filed ?? '—'],
                ['Destination', rec.destination || '—'],
                ['Vehicle', rec.vehicle || '—'],
                ['Inclusive dates', travel(rec.inclusive_from, rec.inclusive_to)],
                ['Departure', dateTime(rec.departure_at)],
                ['Return', dateTime(rec.return_at)],
                ['Recommending approval', `${rec.recommending_name} — ${rec.recommending_title}`],
                ['Approved by', `${rec.approving_name} — ${rec.approving_title}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="font-medium text-slate-700">{label}</dt>
                  <dd className="mt-1 text-slate-900">{value}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-700">Purpose</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-900">{rec.purpose || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-700">Employees</dt>
                <dd className="mt-1 text-slate-900">
                  {rec.employees.length === 0 ? '—' : (
                    <ul aria-label="Employees on this record" className="space-y-1">
                      {rec.employees.map((e) => (
                        <li key={e.employee_id}>
                          <span className="font-medium">{e.full_name}</span>
                          <span className="text-slate-600"> · {e.designation || 'No designation'} · {e.employment_status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>

            <ConfirmDialog
              open={archiveOpen}
              title={`Archive ${rec.form_type} ${rec.number}?`}
              message={'It will be hidden from lists, reports and "out today". Its number is never reused. You can restore it from Archived.'}
              confirmLabel="Archive"
              error={acting.error}
              pending={acting.pending}
              onConfirm={() => setArchived(true)}
              onCancel={() => setArchiveOpen(false)}
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
              confirmLabel="Restore anyway"
              confirmClass={btn.primary}
              error={acting.error}
              pending={acting.pending}
              onConfirm={() => setArchived(false, true)}
              onCancel={() => setOverlaps(null)}
            />
          </>
        )}
        {previewDialog}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Records</h1>
      {notice && <Banner kind="success">{notice}</Banner>}
      {officesError && (
        <Banner action={<button className={btn.link} onClick={loadOffices}>Retry</button>}>{officesError}</Banner>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="w-64">
          <Field label="Search" id="flt-search">
            <input id="flt-search" type="search" className={inputClass} value={filters.search} onChange={set('search')}
              placeholder="Number, name, destination, purpose" />
          </Field>
        </div>
        {filter('formType', 'Form', select('formType', [['', 'All'], ['PLS', 'PLS'], ['TO', 'TO']]))}
        {filter('issuingOffice', 'Issuing office', select('issuingOffice', [['', 'All'], ...Object.entries(ISSUING_OFFICES)]))}
        {filter('officeId', 'Employee office', select('officeId', [['', 'All'], ...offices.map((o) => [String(o.id), o.name])]))}
        {filter('from', 'Travel from', <input id="flt-from" type="date" className={inputClass} value={filters.from} onChange={set('from')} />)}
        {filter('to', 'Travel to', (
          <input id="flt-to" type="date" className={inputClass} value={filters.to} onChange={set('to')}
            aria-invalid={!!list.errors?.to} aria-describedby={list.errors?.to ? 'flt-to-error' : undefined} />
        ))}
        {filter('status', 'Status', select('status', STATUSES))}
      </div>

      {list.status === 'loading' && list.rows.length === 0 && <p className="text-sm text-slate-600">Loading…</p>}
      {list.status === 'error' && !list.errors && (
        <Banner action={<button className={btn.link} onClick={loadList}>Retry</button>}>{list.error}</Banner>
      )}
      {list.status === 'ready' && list.rows.length === 0 && <p className="text-sm text-slate-600">No records found</p>}
      {list.truncated && list.status === 'ready' && (
        <p className="text-sm text-slate-600">Showing the newest 200 records. Narrow the search to see older ones.</p>
      )}
      {list.rows.length > 0 && list.status !== 'error' && (
        <table aria-busy={list.status === 'loading'} className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Form</th>
              <th className="px-4 py-3 font-medium">Office</th>
              <th className="px-4 py-3 font-medium">Names</th>
              <th className="px-4 py-3 font-medium">Destination</th>
              <th className="px-4 py-3 font-medium">Travel dates</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium whitespace-nowrap text-slate-900">{r.number}</td>
                <td className="px-4 py-3 text-slate-600">{r.formType}</td>
                <td className="px-4 py-3 text-slate-600">{ISSUING_OFFICES[r.issuingOffice]}</td>
                <td className="px-4 py-3 text-slate-600">{r.names ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.destination || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{travel(r.inclusiveFrom, r.inclusiveTo)}</td>
                <td className="px-4 py-3 text-slate-600">{statusLabel(r)}</td>
                <td className="px-4 py-3 text-right">
                  <button className={btn.link} aria-label={`Open ${r.number}`} onClick={() => { setNotice(''); openRecord(r.id); }}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
