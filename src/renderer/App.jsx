import { useEffect, useState } from 'react';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Employees from './pages/Employees.jsx';
import Offices from './pages/Offices.jsx';
import Signatories from './pages/Signatories.jsx';
import NewRecord from './pages/NewRecord.jsx';
import Records from './pages/Records.jsx';
import OutToday from './pages/OutToday.jsx';
import Reports from './pages/Reports.jsx';
import DbError from './pages/DbError.jsx';

const dbError = location.hash.startsWith('#db-error=') ? decodeURIComponent(location.hash.slice('#db-error='.length)) : null;
const PAGES = {
  outToday: ['Out today', OutToday], // first page after login (US-1 dashboard)
  employees: ['Employees', Employees],
  offices: ['Offices', Offices],
  signatories: ['Signatories', Signatories],
  newRecord: ['New record', NewRecord],
  records: ['Records', Records],
  reports: ['Reports', Reports],
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session
  const [{ page, params, seq }, setNav] = useState({ page: 'outToday', params: {}, seq: 0 });
  // Every navigation remounts the page, so a nav click always shows the page fresh (e.g. Records list, not a detail).
  const go = (p, prm = {}) => setNav((n) => ({ page: p, params: prm, seq: n.seq + 1 }));

  useEffect(() => {
    if (!dbError) window.api.invoke('auth:me').then((res) => setUser(res.ok ? res.data : null));
  }, []);

  if (dbError) return <DbError message={dbError} />;
  if (user === undefined) return <p className="p-8 text-sm text-slate-600">Loading…</p>;

  const logout = async () => {
    await window.api.invoke('auth:logout');
    setUser(null);
    go('outToday');
  };

  if (!user) return <Login onLogin={setUser} />;
  if (user.mustChangePassword) {
    return <ChangePassword onLogout={logout} onDone={() => setUser({ ...user, mustChangePassword: false })} />;
  }

  const Page = PAGES[page][1];
  return (
    <div className="flex min-h-screen bg-slate-100">
      <nav aria-label="Main" className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="px-3 pb-6 text-sm font-semibold text-slate-900">PLS-TO Records System</p>
        <ul className="space-y-1">
          {Object.entries(PAGES).map(([key, [label]]) => (
            <li key={key}>
              <button
                aria-current={page === key ? 'page' : undefined}
                onClick={() => go(key)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium ${page === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-8 py-3">
          <span className="text-sm text-slate-600">{user.fullName}</span>
          <button className="text-sm font-medium text-blue-700 hover:underline" onClick={logout}>
            Log out
          </button>
        </header>
        <main className="mx-auto max-w-5xl p-8">
          <Page key={seq} params={params} go={go} />
        </main>
      </div>
    </div>
  );
}
