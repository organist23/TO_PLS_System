import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
};
const IDLE = { pending: false, path: '', error: '' };

// US-12: records per office for a travel-date range, with counts and .xlsx export.
export default function Reports() {
  const [filters, setFilters] = useState(() => ({ officeId: '', formType: '', ...thisMonth() }));
  const [query, setQuery] = useState(filters); // debounced filters
  const [offices, setOffices] = useState({ rows: [], error: '' });
  const [report, setReport] = useState({ status: 'loading', rows: [], counts: [] });
  const [exporting, setExporting] = useState(IDLE);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(filters), 250);
    return () => clearTimeout(t);
  }, [filters]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setReport((r) => ({ ...r, status: 'loading' }));
    const res = await window.api.invoke('reports:office', { ...query, officeId: Number(query.officeId) || null });
    if (mine !== seq.current) return; // a newer filter is on its way
    setReport(res.ok ? { status: 'ready', ...res.data } : { status: 'error', rows: [], counts: [], error: res.error, errors: res.errors });
  }, [query]);
  useEffect(() => void load(), [load]);

  const loadOffices = useCallback(async () => {
    const res = await window.api.invoke('offices:list', {});
    setOffices(res.ok ? { rows: res.data, error: '' } : { rows: [], error: res.error });
  }, []);
  useEffect(() => void loadOffices(), [loadOffices]);

  async function exportFile() {
    setExporting({ ...IDLE, pending: true });
    const res = await window.api.invoke('reports:export', { ...query, officeId: Number(query.officeId) || null });
    if (!res.ok) return setExporting({ ...IDLE, error: res.error });
    setExporting({ ...IDLE, path: res.data.canceled ? '' : res.data.path });
  }

  async function openFile() {
    const res = await window.api.invoke('records:openExport');
    if (!res.ok) setExporting((e) => ({ ...e, error: res.error }));
  }

  const set = (key) => (e) => {
    setExporting(IDLE);
    setFilters({ ...filters, [key]: e.target.value });
  };
  const errors = report.errors ?? {};
  const dateInput = (key, label) => (
    <div className="w-44">
      <Field label={label} id={`rep-${key}`} error={errors[key]}>
        <input id={`rep-${key}`} type="date" className={inputClass} value={filters[key]} onChange={set(key)}
          aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `rep-${key}-error` : undefined} />
      </Field>
    </div>
  );
  const ready = report.status === 'ready';

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <button type="button" className={btn.primary} onClick={exportFile}
          disabled={!ready || report.rows.length === 0 || exporting.pending}>
          {exporting.pending ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>
      {offices.error && <Banner action={<button className={btn.link} onClick={loadOffices}>Retry</button>}>{offices.error}</Banner>}
      {exporting.path && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-700">Saved to {exporting.path}</span>
          <button type="button" className={btn.link} onClick={openFile}>Open file</button>
        </div>
      )}
      {exporting.error && <Banner>{exporting.error}</Banner>}

      <div className="flex flex-wrap items-start gap-4">
        <div className="w-64">
          <Field label="Office" id="rep-officeId">
            <select id="rep-officeId" className={inputClass} value={filters.officeId} onChange={set('officeId')}>
              <option value="">All</option>
              {offices.rows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Form" id="rep-formType">
            <select id="rep-formType" className={inputClass} value={filters.formType} onChange={set('formType')}>
              <option value="">All</option>
              <option value="PLS">PLS</option>
              <option value="TO">TO</option>
            </select>
          </Field>
        </div>
        {dateInput('from', 'Travel from')}
        {dateInput('to', 'Travel to')}
      </div>

      {report.status === 'loading' && report.rows.length === 0 && <p className="text-sm text-slate-600">Loading…</p>}
      {report.status === 'error' && !report.errors && (
        <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{report.error}</Banner>
      )}
      {ready && report.rows.length === 0 && <p className="text-sm text-slate-600">No records found</p>}
      {report.rows.length > 0 && report.status !== 'error' && (
        <>
          <table aria-label="Count per office" aria-busy={report.status === 'loading'}
            className="w-full max-w-md overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Office</th>
                <th className="px-4 py-3 text-right font-medium">PLS</th>
                <th className="px-4 py-3 text-right font-medium">TO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.counts.map((c) => (
                <tr key={c.officeName}>
                  <td className="px-4 py-3 font-medium text-slate-900">{c.officeName}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{c.PLS}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{c.TO}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table aria-label="Records" aria-busy={report.status === 'loading'}
            className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {['Office', 'Employee', 'Form', 'Number', 'Date filed', 'Travel dates', 'Destination'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.map((r) => (
                <tr key={`${r.recordId}-${r.fullName}`}>
                  <td className="px-4 py-3 text-slate-600">{r.officeName}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.formType}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.number}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.dateFiled}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.inclusiveFrom} to {r.inclusiveTo}</td>
                  <td className="px-4 py-3 text-slate-600">{r.destination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
