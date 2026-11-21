import { useCallback, useEffect, useRef, useState } from 'react';
import { btn, inputClass, Field, Banner } from '../components/ui.jsx';
import { useOffices } from '../components/useOffices.js';

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateTime = (dt) => (dt ? dt.slice(0, 16) : '—');

// US-11: who is out on a PLS or TO on a date (today by default).
export default function OutToday() {
  const [date, setDate] = useState(() => localDate(new Date()));
  const [officeId, setOfficeId] = useState('');
  const offices = useOffices();
  const [list, setList] = useState({ status: 'loading', rows: [] });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setList((l) => ({ ...l, status: 'loading' }));
    const res = await window.api.invoke('reports:out', { date, officeId: Number(officeId) || null });
    if (mine !== seq.current) return; // a newer date or office is on its way
    setList(res.ok ? { status: 'ready', rows: res.data } : { status: 'error', rows: [], error: res.error, errors: res.errors });
  }, [date, officeId]);
  useEffect(() => void load(), [load]);


  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Out today</h1>
      {offices.error && <Banner action={<button className={btn.link} onClick={offices.retry}>Retry</button>}>{offices.error}</Banner>}

      <div className="flex flex-wrap items-start gap-4">
        <div className="w-44">
          <Field label="Date" id="out-date" error={list.errors?.date}>
            <input id="out-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!list.errors?.date} aria-describedby={list.errors?.date ? 'out-date-error' : undefined} />
          </Field>
        </div>
        <div className="w-64">
          <Field label="Office" id="out-office">
            <select id="out-office" className={inputClass} value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              <option value="">All</option>
              {offices.rows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {list.status === 'loading' && list.rows.length === 0 && <p className="text-sm text-slate-600">Loading…</p>}
      {list.status === 'error' && !list.errors && (
        <Banner action={<button className={btn.link} onClick={load}>Retry</button>}>{list.error}</Banner>
      )}
      {list.status === 'ready' && list.rows.length === 0 && <p className="text-sm text-slate-600">No one is out on this date</p>}
      {list.rows.length > 0 && list.status !== 'error' && (
        <table aria-busy={list.status === 'loading'} className="w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {['Office', 'Employee', 'Form', 'Number', 'Destination', 'Travel dates', 'Return'].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.rows.map((r) => (
              <tr key={`${r.recordId}-${r.employeeId}`}>
                <td className="px-4 py-3 text-slate-600">{r.officeName}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{r.fullName}</td>
                <td className="px-4 py-3 text-slate-600">{r.formType}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.number}</td>
                <td className="px-4 py-3 text-slate-600">{r.destination}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.inclusiveFrom} to {r.inclusiveTo}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{dateTime(r.returnAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
